#!/usr/bin/env bun
/**
 * Fake ACP Agent — full ACP protocol coverage for testing.
 *
 * Implements every Agent-side method and exercises every Client-side capability
 * during the prompt flow so that the companion test harness (client.js / acp-client)
 * can verify complete protocol compliance.
 *
 * @see https://agentclientprotocol.com/protocol/overview
 */

import { createInterface } from 'readline'

const JSONRPC_VERSION = '2.0'

// ── Types ──────────────────────────────────────────────────────

interface JsonRpcMessage {
    jsonrpc?: string
    id?: number
    method?: string
    params?: any
    result?: any
    error?: { code: number; message: string }
    _meta?: any
}

interface PendingRequest {
    resolve: (value: any) => void
    reject: (reason: any) => void
}

interface SessionInfo {
    sessionId: string
    cwd: string
    mcpServers: any[]
    createdAt: string
    title: string
}

interface Mode {
    id: string
    name: string
    description: string
}

// ── Constants ─────────────────────────────────────────────────

const MODES: Mode[] = [
    { id: 'ask', name: '询问', description: '执行任何变更前先请求许可' },
    { id: 'code', name: '编码', description: '使用完整工具权限编写和修改代码' },
]

const PLAN_STEPS: string[] = [
    '请求许可',
    '读取项目文件',
    '编写分析结果',
    '应用编辑并运行命令',
    '生成响应',
]

// Minimal 1x1 transparent PNG (base64)
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Minimal WAV header (44 bytes, 0 samples)
const TINY_WAV = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

// ════════════════════════════════════════════════════════════════
// FakeAcpAgent — class-based Agent implementation
// ════════════════════════════════════════════════════════════════

class FakeAcpAgent {
    private _sessionCounter: number = 0
    private _outgoingRequestId: number = 1000
    private _currentModeId: string = 'code'
    private _currentModelId: string = 'fake-model-1'
    private _clientCapabilities: any = {}
    private _sessions: Map<string, SessionInfo> = new Map()
    private _cancelledSessions: Set<string> = new Set()
    private _pendingOutgoing: Map<number, PendingRequest> = new Map()

    // ── Config builder ────────────────────────────────────────

    private buildConfigOptions(): any[] {
        return [
            {
                id: 'mode',
                name: '会话模式',
                category: 'mode',
                type: 'select',
                currentValue: this._currentModeId,
                options: [
                    { value: 'ask', name: '询问', description: '变更前请求许可' },
                    { value: 'code', name: '编码', description: '完整工具权限' },
                ],
            },
            {
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: this._currentModelId,
                options: [
                    { value: 'fake-model-1', name: '模拟模型 1', description: '速度较快，能力较弱' },
                    { value: 'fake-model-2', name: '模拟模型 2', description: '速度较慢，能力较强' },
                ],
            },
        ]
    }

    // ── Helpers ────────────────────────────────────────────────

    private meta(): { timestamp: string; agent: string } {
        return { timestamp: new Date().toISOString(), agent: 'fake-acp-agent' }
    }

    private sendResponse(id: number, result: any): void {
        process.stdout.write(JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, result, _meta: this.meta() }) + '\n')
    }

    private sendError(id: number, code: number, message: string): void {
        process.stdout.write(
            JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, error: { code, message }, _meta: this.meta() }) + '\n',
        )
    }

    private sendNotification(method: string, params: any): void {
        process.stdout.write(JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, params, _meta: this.meta() }) + '\n')
    }

    private sendRequest(method: string, params: any): number {
        const id = ++this._outgoingRequestId
        process.stdout.write(
            JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params, _meta: this.meta() }) + '\n',
        )
        return id
    }

    private waitForResponse(id: number): Promise<any> {
        return new Promise((resolve, reject) => {
            this._pendingOutgoing.set(id, { resolve, reject })
        })
    }

    private async callClient(method: string, params: any): Promise<any> {
        const id = this.sendRequest(method, params)
        return this.waitForResponse(id)
    }

    private emitChunk(sessionId: string, text: string): void {
        this.sendNotification('session/update', {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
        })
    }

    private emitContentChunk(sessionId: string, content: any): void {
        this.sendNotification('session/update', {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content },
        })
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((r) => setTimeout(r, ms))
    }

    private isCancelled(sid: string): boolean {
        return this._cancelledSessions.has(sid)
    }

    // ── Main router ───────────────────────────────────────────

    async handleMessage(message: JsonRpcMessage): Promise<void> {
        const { id, method } = message

        // Response to an outgoing request (Agent → Client)
        if (id !== undefined && method === undefined) {
            const pending = this._pendingOutgoing.get(id)
            if (pending) {
                this._pendingOutgoing.delete(id)
                message.error
                    ? pending.reject(new Error(`[${message.error.code}] ${message.error.message}`))
                    : pending.resolve(message.result)
            }
            return
        }

        // Extended methods (prefixed with _)
        if (method && method.startsWith('_')) return this.handleExtendedMethod(id!, method, message.params)

        switch (method) {
            case 'initialize':
                return this.handleInitialize(id!, message.params)
            case 'authenticate':
                return this.handleAuthenticate(id!, message.params)
            case 'session/new':
                return this.handleSessionNew(id!, message.params)
            case 'session/load':
                return this.handleSessionLoad(id!, message.params)
            case 'session/list':
                return this.handleSessionList(id!, message.params)
            case 'session/prompt':
                return this.handlePrompt(id!, message.params)
            case 'session/cancel':
                return this.handleSessionCancel(message.params)
            case 'session/set_mode':
                return this.handleSetMode(id!, message.params)
            case 'session/set_config_option':
                return this.handleSetConfigOption(id!, message.params)
            default:
                if (id !== undefined) this.sendError(id, -32601, `未找到方法：${method}`)
        }
    }

    // ── Handlers ──────────────────────────────────────────────

    private handleInitialize(id: number, params: any): void {
        this._clientCapabilities = params?.clientCapabilities || {}
        this.sendResponse(id, {
            protocolVersion: 1,
            agentCapabilities: {
                loadSession: true,
                promptCapabilities: { image: true, audio: true, embeddedContext: true },
                mcpCapabilities: { http: true, sse: true },
                sessionCapabilities: { list: true },
            },
            agentInfo: { name: 'fake-acp-agent', title: 'ACP 模拟智能体', version: '1.0.0' },
            authMethods: [{ id: 'api-key', description: 'API 密钥身份验证' }],
        })
    }

    private handleAuthenticate(id: number, params: any): void {
        this.sendResponse(id, {
            authenticated: true,
            methodId: params?.methodId || 'unknown',
            user: { name: 'fake-user', email: 'fake@example.com' },
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        })
    }

    private handleSessionNew(id: number, params: any): void {
        this._sessionCounter++
        const sessionId = `fake-session-${this._sessionCounter}`
        const cwd = params?.cwd || '/workspace'
        const mcpServers = params?.mcpServers || []
        this._currentModeId = 'code'

        this._sessions.set(sessionId, {
            sessionId,
            cwd,
            mcpServers,
            createdAt: new Date().toISOString(),
            title: `会话 ${this._sessionCounter}`,
        })

        this.sendResponse(id, {
            sessionId,
            modes: { currentModeId: this._currentModeId, availableModes: MODES },
            configOptions: this.buildConfigOptions(),
        })

        // Slash commands
        this.sendNotification('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'available_commands_update',
                availableCommands: [
                    { name: 'test', description: '运行测试' },
                    { name: 'plan', description: '创建实施计划', input: { hint: '描述' } },
                    { name: 'compact', description: '压缩会话历史' },
                ],
            },
        })

        // MCP acknowledgment
        if (mcpServers.length > 0) {
            const names = mcpServers.map((s: any) => `${s.name}(${s.type || 'unknown'})`).join(', ')
            this.emitChunk(sessionId, `[MCP] 已加载 ${mcpServers.length} 个服务：${names}\n`)
        }
    }

    private handleSessionLoad(id: number, params: any): void {
        const sessionId = params?.sessionId
        this.sendNotification('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'user_message_chunk',
                content: { type: 'text', text: '如何在 Node.js 中读取文件？' },
            },
        })
        this.sendNotification('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                    type: 'text',
                    text: 'Use `fs.readFileSync(path, "utf-8")` or `fs.promises.readFile(path, "utf-8")`.',
                },
            },
        })
        this.sendResponse(id, {
            modes: { currentModeId: this._currentModeId, availableModes: MODES },
            configOptions: this.buildConfigOptions(),
        })
    }

    private handleSessionList(id: number, params: any): void {
        const cursor = params?.cursor || null
        const limit = params?.limit || 50

        const all: Array<{ sessionId: string; title: string; createdAt: string }> = []
        for (const [, s] of this._sessions) {
            all.push({ sessionId: s.sessionId, title: s.title, createdAt: s.createdAt })
        }

        let start = 0
        if (cursor) {
            const idx = all.findIndex((s) => s.sessionId === cursor)
            start = idx >= 0 ? idx + 1 : 0
        }

        const page = all.slice(start, start + limit)
        const nextCursor = start + limit < all.length ? all[start + limit - 1].sessionId : null

        this.sendResponse(id, { sessions: page, ...(nextCursor ? { nextCursor } : {}) })
    }

    private handleSessionCancel(params: any): void {
        if (params?.sessionId) this._cancelledSessions.add(params.sessionId)
    }

    private handleSetMode(id: number, params: any): void {
        this._currentModeId = params?.modeId || 'code'
        this.sendNotification('session/update', {
            sessionId: params?.sessionId,
            update: { sessionUpdate: 'current_mode_update', modeId: this._currentModeId },
        })
        this.sendResponse(id, { modes: { currentModeId: this._currentModeId, availableModes: MODES } })
    }

    private handleSetConfigOption(id: number, params: any): void {
        const { configId, value, sessionId } = params || {}
        if (configId === 'mode') this._currentModeId = value
        if (configId === 'model') this._currentModelId = value

        this.sendNotification('session/update', {
            sessionId,
            update: { sessionUpdate: 'config_option_update', configId, value },
        })
        this.sendResponse(id, { configOptions: this.buildConfigOptions() })
    }

    private handleExtendedMethod(id: number, method: string, params: any): void {
        if (method === '_ping') {
            return this.sendResponse(id, { pong: true, timestamp: new Date().toISOString(), echo: params })
        }
        if (id !== undefined) {
            this.sendResponse(id, { method, acknowledged: true })
        }
    }

    // ── Prompt handler — exercises every Client capability ─────

    private async handlePrompt(id: number, params: any): Promise<void> {
        const sessionId = params?.sessionId || 'unknown'
        const promptText = Array.isArray(params?.prompt) && params.prompt[0]?.text ? params.prompt[0].text : 'unknown'

        this._cancelledSessions.delete(sessionId)

        // ── 1. Plan (all pending) ──
        this.emitPlan(sessionId, -1)

        // ── 2. Opening chunks ──
        const opening = `正在处理：“${promptText}”\n\n`
        for (let i = 0; i < opening.length; i += 20) this.emitChunk(sessionId, opening.slice(i, i + 20))

        // ── Cancel checkpoint ──
        await this.sleep(150)
        if (this.isCancelled(sessionId)) return this.sendResponse(id, { stopReason: 'cancelled' })

        // ── 3. Request permission (PM1, PM2) ──
        this.emitPlan(sessionId, 0, 'in_progress')
        try {
            const perm: any = await this.callClient('session/request_permission', {
                sessionId,
                toolCall: { toolCallId: 'call_perm' },
                options: [
                    { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
                    { optionId: 'allow-always', name: '始终允许', kind: 'allow_always' },
                    { optionId: 'reject-once', name: '拒绝一次', kind: 'reject_once' },
                ],
            })
            this.emitChunk(sessionId, `许可结果：${perm.outcome?.outcome ?? '未知'}\n`)
        } catch (err: any) {
            this.emitChunk(sessionId, `许可错误：${err.message}\n`)
        }
        this.emitPlan(sessionId, 0, 'completed')

        await this.sleep(50)
        if (this.isCancelled(sessionId)) return this.sendResponse(id, { stopReason: 'cancelled' })

        // ── 4. Tool: read — fs/read full + line/limit (FS1, FS3) ──
        this.emitPlan(sessionId, 1, 'in_progress')
        let toolN = 0
        if (this._clientCapabilities?.fs?.readTextFile) {
            const callId = `call_${++toolN}`
            this.emitToolCall(sessionId, callId, '正在读取文件', 'read')

            // Write a multi-line file first so we can test line/limit
            if (this._clientCapabilities?.fs?.writeTextFile) {
                await this.callClient('fs/write_text_file', {
                    sessionId,
                    path: '/tmp/acp-multiline.txt',
                    content: 'line1\nline2\nline3\nline4\nline5\n',
                })
            }

            try {
                // Full read (FS1)
                const full: any = await this.callClient('fs/read_text_file', {
                    sessionId,
                    path: '/tmp/acp-multiline.txt',
                })
                // Partial read with line/limit (FS3)
                const partial: any = await this.callClient('fs/read_text_file', {
                    sessionId,
                    path: '/tmp/acp-multiline.txt',
                    line: 2,
                    limit: 2,
                })
                this.completeToolCall(sessionId, callId, `full=${full.content?.length}c, partial="${partial.content}"`)
                this.emitChunk(sessionId, `读取成功（第 2 至 3 行：“${partial.content}”）\n`)
            } catch (err: any) {
                this.failToolCall(sessionId, callId, err.message)
            }
        }
        this.emitPlan(sessionId, 1, 'completed')

        // ── 5. Tool: write — fs/write_text_file (FS2) ──
        this.emitPlan(sessionId, 2, 'in_progress')
        if (this._clientCapabilities?.fs?.writeTextFile) {
            const callId = `call_${++toolN}`
            this.emitToolCall(sessionId, callId, '正在编写分析', 'write')
            try {
                const content = JSON.stringify(
                    {
                        agent: 'fake-acp-agent',
                        timestamp: new Date().toISOString(),
                        prompt: promptText,
                        analysis: { sentiment: 'neutral', tokens: promptText.split(/\s+/).length },
                    },
                    null,
                    2,
                )
                await this.callClient('fs/write_text_file', { sessionId, path: '/tmp/acp-analysis.json', content })
                this.completeToolCall(sessionId, callId, `已写入 ${content.length} 字节`)
                this.emitChunk(sessionId, `分析已写入（${content.length} 字节）\n`)
            } catch (err: any) {
                this.failToolCall(sessionId, callId, err.message)
            }
        }
        this.emitPlan(sessionId, 2, 'completed')

        // ── 6. Tool: edit — file diff (TC3 edit, TC4 file_diff) ──
        this.emitPlan(sessionId, 3, 'in_progress')
        {
            const callId = `call_${++toolN}`
            this.emitToolCall(sessionId, callId, '正在编辑配置', 'edit')
            if (this._clientCapabilities?.fs?.writeTextFile) {
                try {
                    await this.callClient('fs/write_text_file', {
                        sessionId,
                        path: '/tmp/acp-config.json',
                        content: '{\n  "debug": true,\n  "version": "1.0.1"\n}\n',
                    })
                } catch {
                    /* ignore */
                }
            }
            this.sendNotification('session/update', {
                sessionId,
                update: {
                    sessionUpdate: 'tool_call_update',
                    toolCallId: callId,
                    status: 'completed',
                    content: [
                        {
                            type: 'file_diff',
                            path: '/tmp/acp-config.json',
                            before: '{\n  "debug": false,\n  "version": "1.0.0"\n}\n',
                            after: '{\n  "debug": true,\n  "version": "1.0.1"\n}\n',
                        },
                    ],
                },
            })
            this.emitChunk(sessionId, '配置编辑已应用\n')
        }

        // ── 7. Tool: execute — terminal create+output+wait+release (TM1-3,5) ──
        if (this._clientCapabilities?.terminal) {
            const callId = `call_${++toolN}`
            this.emitToolCall(sessionId, callId, '正在运行 echo', 'execute')
            try {
                const term: any = await this.callClient('terminal/create', {
                    sessionId,
                    command: 'echo',
                    args: ['来自 fake-acp-agent 的问候'],
                })
                this.sendNotification('session/update', {
                    sessionId,
                    update: {
                        sessionUpdate: 'tool_call_update',
                        toolCallId: callId,
                        status: 'in_progress',
                        content: [{ type: 'terminal', terminalId: term.terminalId }],
                    },
                })
                await this.callClient('terminal/wait_for_exit', { sessionId, terminalId: term.terminalId })
                const output: any = await this.callClient('terminal/output', { sessionId, terminalId: term.terminalId })
                await this.callClient('terminal/release', { sessionId, terminalId: term.terminalId })
                this.completeToolCall(sessionId, callId, `输出：${(output.output || '').trim()}`)
                this.emitChunk(sessionId, `终端：${(output.output || '').trim()}\n`)
            } catch (err: any) {
                this.failToolCall(sessionId, callId, err.message)
            }
        }

        // ── 8. Tool: execute — terminal/kill (TM4) ──
        if (this._clientCapabilities?.terminal) {
            const callId = `call_${++toolN}`
            this.emitToolCall(sessionId, callId, '终止长时间运行的进程', 'execute')
            try {
                const term: any = await this.callClient('terminal/create', {
                    sessionId,
                    command: 'sleep',
                    args: ['60'],
                })
                await this.sleep(50)
                await this.callClient('terminal/kill', { sessionId, terminalId: term.terminalId })
                await this.callClient('terminal/wait_for_exit', { sessionId, terminalId: term.terminalId })
                const output: any = await this.callClient('terminal/output', { sessionId, terminalId: term.terminalId })
                await this.callClient('terminal/release', { sessionId, terminalId: term.terminalId })
                const info = output.exitStatus
                    ? `退出码=${output.exitStatus.exitCode}，信号=${output.exitStatus.signal}`
                    : '已终止'
                this.completeToolCall(sessionId, callId, `已终止（${info}）`)
                this.emitChunk(sessionId, `进程已终止（${info}）\n`)
            } catch (err: any) {
                this.failToolCall(sessionId, callId, err.message)
            }
        }

        // ── 9. Tool: failed (TC2 failed status) ──
        {
            const callId = `call_${++toolN}`
            this.emitToolCall(sessionId, callId, '高风险操作', 'execute')
            this.sendNotification('session/update', {
                sessionId,
                update: { sessionUpdate: 'tool_call_update', toolCallId: callId, status: 'in_progress' },
            })
            this.sendNotification('session/update', {
                sessionId,
                update: {
                    sessionUpdate: 'tool_call_update',
                    toolCallId: callId,
                    status: 'failed',
                    content: [{ type: 'content', content: { type: 'text', text: '用于测试的模拟失败' } }],
                },
            })
            this.emitChunk(sessionId, '工具按预期失败\n')
        }
        this.emitPlan(sessionId, 3, 'completed')

        // ── 10. Content types (CT2-CT5) ──
        this.emitPlan(sessionId, 4, 'in_progress')

        // CT2: ImageContent
        this.emitContentChunk(sessionId, { type: 'image', data: TINY_PNG, mimeType: 'image/png' })
        this.emitChunk(sessionId, '图片已发送\n')

        // CT3: AudioContent
        this.emitContentChunk(sessionId, { type: 'audio', data: TINY_WAV, mimeType: 'audio/wav' })
        this.emitChunk(sessionId, '音频已发送\n')

        // CT4: EmbeddedResource
        this.emitContentChunk(sessionId, {
            type: 'resource',
            resource: { uri: 'file:///tmp/acp-analysis.json', mimeType: 'application/json', text: '{"embedded":true}' },
        })
        this.emitChunk(sessionId, '嵌入资源已发送\n')

        // CT5: ResourceLink
        this.emitContentChunk(sessionId, {
            type: 'resource_link',
            uri: 'file:///workspace/README.md',
            title: '项目 README',
            mimeType: 'text/markdown',
        })
        this.emitChunk(sessionId, '资源链接已发送\n')

        this.emitPlan(sessionId, 4, 'completed')

        // ── 11. Final ──
        this.emitChunk(sessionId, `\n完成，共执行 ${toolN} 次工具调用。\n`)
        this.sendResponse(id, { stopReason: 'end_turn' })
    }

    // ── Notification helpers ──────────────────────────────────

    private emitToolCall(sessionId: string, toolCallId: string, title: string, kind: string): void {
        this.sendNotification('session/update', {
            sessionId,
            update: { sessionUpdate: 'tool_call', toolCallId, title, kind, status: 'pending' },
        })
    }

    private completeToolCall(sessionId: string, toolCallId: string, text: string): void {
        this.sendNotification('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'tool_call_update',
                toolCallId,
                status: 'completed',
                content: [{ type: 'content', content: { type: 'text', text } }],
            },
        })
    }

    private failToolCall(sessionId: string, toolCallId: string, text: string): void {
        this.sendNotification('session/update', {
            sessionId,
            update: {
                sessionUpdate: 'tool_call_update',
                toolCallId,
                status: 'failed',
                content: [{ type: 'content', content: { type: 'text', text } }],
            },
        })
    }

    private emitPlan(sessionId: string, completedUpTo: number, currentStatus?: string): void {
        const entries = PLAN_STEPS.map((content, i) => ({
            content,
            priority: i < 3 ? 'high' : 'medium',
            status: i < completedUpTo ? 'completed' : i === completedUpTo ? currentStatus || 'completed' : 'pending',
        }))
        this.sendNotification('session/update', { sessionId, update: { sessionUpdate: 'plan', entries } })
    }

    // ── stdin reader — start listening ─────────────────────────

    start(): void {
        const rl = createInterface({ input: process.stdin, terminal: false })
        rl.on('line', (line: string) => {
            const trimmed = line.trim()
            if (!trimmed) return
            try {
                this.handleMessage(JSON.parse(trimmed))
            } catch {
                /* ignore */
            }
        })
        process.stdin.resume()
    }
}

// ════════════════════════════════════════════════════════════════
// Entry point
// ════════════════════════════════════════════════════════════════

export { FakeAcpAgent }

// ── CLI entry point ───────────────────────────────────────────

const HELP = `fake-agent — 用于协议合规测试的 ACP 模拟智能体

用法：
  fake-agent acp            通过标准输入输出启动 ACP 智能体（子命令形式）
  fake-agent --acp          通过标准输入输出启动 ACP 智能体（参数形式）

示例：
  bun run kits/fake/agent.ts acp
  bun run kits/fake/agent.ts --acp`

function main(): void {
    const args = process.argv.slice(2)

    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP)
        process.exit(0)
    }

    if (args.includes('acp') || args.includes('--acp')) {
        const agent = new FakeAcpAgent()
        agent.start()
        return
    }

    console.error(HELP)
    process.exit(1)
}

if (require.main === module) main()
