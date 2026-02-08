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
| `descriptionHtml`    | string   | HTML version of description (use `HTML`)   |
| `problem`            | string   | Problem statement (40-80 words)            |
| `problemHtml`        | string   | HTML version of problem (use `HTML`)       |
| `solution`           | string   | Solution statement (40-80 words)           |
| `solutionHtml`       | string   | HTML version of solution (use `HTML`)      |
| `process`            | string   | Business process                           |
| `domain`             | string   | Business domain                            |
| `technologies`       | string[] | Technology list (array, for loops)         |
| `technologiesText`   | string   | Technologies joined with ", "              |
| `benefits`           | string[] | Benefits list (array, for loops)           |
| `benefitsText`       | string   | Benefits joined with newlines              |
| `benefitsHtml`       | string   | HTML list of benefits (use `HTML`)         |
| `metrics`            | string[] | Metrics list (array, for loops)            |
| `metricsText`        | string   | Metrics joined with newlines               |
| `metricsHtml`        | string   | HTML list of metrics (use `HTML`)          |
| `risks`              | string[] | Risks list (array, for loops)              |
| `risksText`          | string   | Risks joined with newlines                 |
| `risksHtml`          | string   | HTML list of risks (use `HTML`)            |
| `constraints`        | string[] | Constraints list (array, for loops)        |
| `constraintsText`    | string   | Constraints joined with newlines           |
| `constraintsHtml`    | string   | HTML list of constraints (use `HTML`)      |
| `nextSteps`          | string[] | Next steps list (array, for loops)         |
| `nextStepsText`      | string   | Next steps joined with newlines            |
| `nextStepsHtml`      | string   | HTML list of next steps (use `HTML`)       |
| `dataSources`        | string[] | Data sources list (array, for loops)       |
| `dataSourcesText`    | string   | Data sources joined with ", "              |
| `dataSourcesHtml`    | string   | HTML list of data sources (use `HTML`)     |
| `dataObjects`        | string[] | Data objects list (array, for loops)       |
| `dataObjectsText`    | string   | Data objects joined with ", "              |
| `dataObjectsHtml`    | string   | HTML list of data objects (use `HTML`)     |
| `references`         | object[] | References list `{ title, url, excerpt }`  |
| `referencesText`     | string   | References joined with newlines            |
| `referencesHtml`     | string   | HTML references list (use `HTML`)          |
| `deadline`           | string   | Target deadline                            |
| `contact`            | string   | Contact person                             |
| `totalValueScore`    | number   | Calculated value score (0-100)             |
| `totalComplexityScore`| number  | Calculated complexity score (0-100)        |
| `valueAxes`          | object[] | Axis list `{ title, score, stars, description, descriptionHtml }` |
| `complexityAxes`     | object[] | Axis list `{ title, score, stars, description, descriptionHtml }` |
| `createdAt`          | string   | ISO date of creation                       |

### Example template content

Inside the `.docx` template, use placeholders like:

```
{{name}}

Description: {{HTML descriptionHtml}}

Problem: {{HTML problemHtml}}
Solution: {{HTML solutionHtml}}

Domain: {{domain}}
Process: {{process}}
Technologies: {{technologiesText}}

Benefits:
{{HTML benefitsHtml}}

Risks:
{{HTML risksHtml}}

Value Score: {{totalValueScore}} / 100
Complexity Score: {{totalComplexityScore}} / 100

Value Axes (loop):
{{FOR ax IN (valueAxes || [])}}
- {{ax.title}} ({{ax.score}} pts, {{ax.stars}}/5)
  {{HTML ax.descriptionHtml}}
{{END-FOR ax}}

Complexity Axes (loop):
{{FOR ax IN (complexityAxes || [])}}
- {{ax.title}} ({{ax.score}} pts, {{ax.stars}}/5)
  {{HTML ax.descriptionHtml}}
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
