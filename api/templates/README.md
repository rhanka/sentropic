# DOCX Templates

This directory contains `.docx` templates used by the DOCX export service.

## Runtime

- Engine: `dolanmiu/docx` (`patchDocument`)
- Placeholders: `{{ ... }}`
- Loop syntax supported by the service: `{{FOR item IN (...)}} ... {{END-FOR item}}`
- Template source: `word/document.xml` inside `usecase-onepage.docx`

## Markdown rendering

Markdown is converted server-side to styled Word runs (bold/italic/strike, line
breaks, simple bullets) before patching placeholders in the template.

## Template authoring constraints

1. Keep placeholders as complete tokens (do not split a placeholder across runs).
2. Keep loop markers on their own lines/paragraphs.
3. Keep loop variables with `$` access, for example: `{{$ax.title}}`.
