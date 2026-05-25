---
name: web
description: Online web search and page-content extraction for current external information.
version: 0.1.0
category: web
contextFilter:
  requiresOnline: true
tools:
  - name: web_search
    description: Tavily Search API for real-time web search. Use this tool to search for current information on the web.
    inputSchema:
      type: object
      properties:
        query:
          type: string
          description: The search query to find relevant information.
      required: [query]
  - name: web_extract
    description: Extract and retrieve the full content of one or more existing web page URLs. Use this tool when the user asks for details about references or when you need to analyze specific URLs. Pass all URLs in one call using the urls array.
    inputSchema:
      type: object
      properties:
        urls:
          type: array
          items:
            type: string
          description: Array of URLs to extract content from. Must contain all URLs you need to extract in a single call.
      required: [urls]
---

# Web skill
Use `web_search` for current external information and `web_extract` for known
URLs already available in context.

For extraction, pass every URL needed for the task in one `urls` array. Never
call `web_extract` with an empty array.
