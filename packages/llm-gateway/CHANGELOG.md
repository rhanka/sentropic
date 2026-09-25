# Changelog

## 0.19.0

- Add opt-in budget admission: `BudgetAdmissionPort` (`admit`, `markDispatched`,
  `release`) and the `budget` router option. Without it, the routed flow is unchanged.
- The gateway computes the route quote in-process (mesh `^0.22.0` `RoutePlanner.quote`)
  and pins the plan to it; a budget with a planner lacking `quote()` fails at construction
  with `BudgetConfigurationError`.
- Pre-acquisition refusals on both wires and both JSON/stream flows: over-budget uses the
  frozen 429 body with `Retry-After` bounded to 1-60 seconds; pricing/store failures use the
  sanitized 503 (new internal kind `budget-unavailable`); invalid ceilings return 400.
- `RouteRequestSettlement` gains optional `requestId`, `holdRef`, `quoteRef` and `overrun`;
  dispatched attempts without usage are charged at least their quoted allowance.
- Dependency floor: `@sentropic/llm-mesh` `^0.22.0`.
