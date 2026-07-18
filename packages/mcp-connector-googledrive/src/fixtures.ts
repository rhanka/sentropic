export const aboutFixture = {
  user: {
    displayName: "Jane Doe",
    emailAddress: "jane.doe@example.com"
  },
  storageQuota: {
    limit: "16106127360", // 15 GB
    usage: "5368709120"   // 5 GB
  }
};

export const filesListFixture = {
  files: [
    { id: "file-doc-1", name: "Project Plan", mimeType: "application/vnd.google-apps.document" },
    { id: "file-sheet-1", name: "Q2 Financials", mimeType: "application/vnd.google-apps.spreadsheet" },
    { id: "file-slides-1", name: "Pitch Deck", mimeType: "application/vnd.google-apps.presentation" },
    { id: "file-pdf-1", name: "API Specification.pdf", mimeType: "application/pdf" },
    { id: "file-txt-1", name: "notes.txt", mimeType: "text/plain" }
  ]
};

export const filesMetadataMap: Record<string, { id: string; name: string; mimeType: string; size: string }> = {
  "file-doc-1": { id: "file-doc-1", name: "Project Plan", mimeType: "application/vnd.google-apps.document", size: "1024" },
  "file-sheet-1": { id: "file-sheet-1", name: "Q2 Financials", mimeType: "application/vnd.google-apps.spreadsheet", size: "2048" },
  "file-slides-1": { id: "file-slides-1", name: "Pitch Deck", mimeType: "application/vnd.google-apps.presentation", size: "4096" },
  "file-pdf-1": { id: "file-pdf-1", name: "API Specification.pdf", mimeType: "application/pdf", size: "153600" },
  "file-txt-1": { id: "file-txt-1", name: "notes.txt", mimeType: "text/plain", size: "256" }
};

export const filesExportMap: Record<string, { content: string; mimeType: string }> = {
  "file-doc-1": { content: "# Project Plan\n\n- Task 1: Complete recoding\n- Task 2: Validate benchmarks", mimeType: "text/markdown" },
  "file-sheet-1": { content: "Quarter,Revenue,Expenses\nQ1,$10000,$8000\nQ2,$12000,$9000", mimeType: "text/csv" },
  "file-slides-1": { content: "# Pitch Deck\n\nSlide 1: Sentropic MCP platform\nSlide 2: Read-only Google Drive connector proof", mimeType: "text/plain" }
};

export const permissionsMap: Record<string, Array<{ id: string; role: string; type: string; emailAddress?: string }>> = {
  "file-doc-1": [
    { id: "perm-owner", role: "owner", type: "user", emailAddress: "jane.doe@example.com" },
    { id: "perm-reader", role: "reader", type: "user", emailAddress: "bob@example.com" }
  ],
  "file-sheet-1": [
    { id: "perm-owner", role: "owner", type: "user", emailAddress: "jane.doe@example.com" }
  ]
};

export const commentsMap: Record<string, Array<{ id: string; content: string; author: { displayName: string } }>> = {
  "file-doc-1": [
    { id: "comment-1", content: "Should we add a section for testing?", author: { displayName: "Bob Smith" } }
  ]
};
