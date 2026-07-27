# Extension manifest schema

`extension-manifest.v1.schema.json` is the only supported TjuaeUI extension
manifest contract. TjuaeHub does not provide aliases for earlier filenames,
engine keys, package prefixes, or environment variables.

Every `contributes.*` field may be declared inline or as a `$file:` reference
to a relative `.json` file. References use forward slashes and must not contain
leading whitespace, absolute paths, Windows drive or UNC paths, backslashes,
empty path segments, or `..` traversal segments.
