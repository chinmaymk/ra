# File Attachments

Attach images, PDFs, and text files to any prompt. ra detects the MIME type and sends the content in the right format for each provider.

## CLI

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf --file data.csv "Summarize both files"
```

## REPL

Use `/attach` to add files to your next message:

```
> /attach architecture.png
> How should we refactor this?
```

## Supported formats

ra detects the MIME type automatically. Images are sent as vision content, PDFs as document content, and text files are inlined. Multiple `--file` flags or `/attach` commands can be used to attach several files at once.
