# DOCX Templates

This directory contains `.docx` template files used by the `docx-templates` library
for server-side document generation.

## Template: `usecase-onepage.docx`

A one-page use-case summary. The template uses **`{{ }}`** delimiters (Mustache-style)
for variable interpolation.

### Available variables

| Variable              | Type     | Description                                |
|-----------------------|----------|--------------------------------------------|
| `id`                  | string   | Use case UUID                              |
| `name`               | string   | Use case name                              |
| `description`        | string   | Short description (30-60 words)            |
| `description`        | string   | Markdown converted to HTML (auto `HTML`)   |
| `problem`            | string   | Problem statement (40-80 words)            |
| `problem`            | string   | Markdown converted to HTML (auto `HTML`)   |
| `solution`           | string   | Solution statement (40-80 words)           |
| `solution`           | string   | Markdown converted to HTML (auto `HTML`)   |
| `process`            | string   | Business process                           |
| `domain`             | string   | Business domain                            |
| `technologies`       | string[] | Technology list (array, for loops)         |
| `technologiesText`   | string   | Technologies joined with ", "              |
| `benefits`           | string[] | Benefits list (array, for loops)           |
| `benefitsText`       | string   | Benefits joined with newlines              |
| `benefits`           | string[] | Markdown items converted to HTML           |
| `metrics`            | string[] | Metrics list (array, for loops)            |
| `metricsText`        | string   | Metrics joined with newlines               |
| `metrics`            | string[] | Markdown items converted to HTML           |
| `risks`              | string[] | Risks list (array, for loops)              |
| `risksText`          | string   | Risks joined with newlines                 |
| `risks`              | string[] | Markdown items converted to HTML           |
| `constraints`        | string[] | Constraints list (array, for loops)        |
| `constraintsText`    | string   | Constraints joined with newlines           |
| `constraints`        | string[] | Markdown items converted to HTML           |
| `nextSteps`          | string[] | Next steps list (array, for loops)         |
| `nextStepsText`      | string   | Next steps joined with newlines            |
| `nextSteps`          | string[] | Markdown items converted to HTML           |
| `dataSources`        | string[] | Data sources list (array, for loops)       |
| `dataSourcesText`    | string   | Data sources joined with ", "              |
| `dataSources`        | string[] | Markdown items converted to HTML           |
| `dataObjects`        | string[] | Data objects list (array, for loops)       |
| `dataObjectsText`    | string   | Data objects joined with ", "              |
| `dataObjects`        | string[] | Markdown items converted to HTML           |
| `references`         | object[] | References list `{ title, url, excerpt }`  |
| `referencesText`     | string   | References joined with newlines            |
| `references`         | object[] | `excerpt` converted to HTML                |
| `deadline`           | string   | Target deadline                            |
| `contact`            | string   | Contact person                             |
| `totalValueScore`    | number   | Calculated value score (0-100)             |
| `totalComplexityScore`| number  | Calculated complexity score (0-100)        |
| `valueAxes`          | object[] | Axis list `{ title, score, stars, description }` (description is HTML) |
| `complexityAxes`     | object[] | Axis list `{ title, score, stars, description }` (description is HTML) |
| `createdAt`          | string   | ISO date of creation                       |

### Example template content

Inside the `.docx` template, use placeholders like:

```
{{name}}

Description: {{description}}

Problem: {{problem}}
Solution: {{solution}}

Domain: {{domain}}
Process: {{process}}
Technologies: {{technologiesText}}

Benefits:
{{FOR benefit IN (benefits || [])}}
- {{benefit}}
{{END-FOR benefit}}

Risks:
{{FOR risk IN (risks || [])}}
- {{risk}}
{{END-FOR risk}}

Value Score: {{totalValueScore}} / 100
Complexity Score: {{totalComplexityScore}} / 100

Value Axes (loop):
{{FOR ax IN (valueAxes || [])}}
- {{ax.title}} ({{ax.score}} pts, {{ax.stars}}/5)
  {{ax.description}}
{{END-FOR ax}}

Complexity Axes (loop):
{{FOR ax IN (complexityAxes || [])}}
- {{ax.title}} ({{ax.score}} pts, {{ax.stars}}/5)
  {{ax.description}}
{{END-FOR ax}}
```

For list iteration (advanced):
```
{{FOR benefit IN benefits}}
• {{benefit}}
{{END-FOR benefit}}
```

### Creating the template

1. Create a `.docx` file in Microsoft Word or LibreOffice Writer.
2. Design your one-page layout with styles, headers, and formatting.
3. Insert `{{ variableName }}` placeholders where dynamic content should appear.
4. Save as `usecase-onepage.docx` in this directory.
