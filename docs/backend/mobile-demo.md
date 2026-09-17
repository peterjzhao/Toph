# Mobile API compatibility

The active guide is [Mobile API](mobile.md). The previous demo implementation has been
consolidated into `src/server/mobile/` and the canonical `/api/mobile/v1` routes.

Old `/api/mobile/demo/v1` URLs remain thin aliases so installed apps and saved recording
links keep working. Shared farm profiles still do not provide user authentication.
See [recording processing](transcription.md) for transcription and structured form filling.
