# Changelog

## 0.4.1

- Preserve opt-in domain outcomes in MCP JSON content, including invocation identity,
  commit state, replay status and typed error details. Decode the same envelope on
  both transports without duplicating content. Other providers retain their codec.
