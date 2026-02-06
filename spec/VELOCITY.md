## Velocity (Git commit baseline)

Scope: repository `/home/antoinefa/src/top-ai-ideas-fullstack`, rolling 8‑week window.

### Reproducible commands
```bash
# Total commits over 8 weeks
git log --since='8 weeks ago' --pretty=oneline | wc -l

# Daily distribution (ISO date)
git log --since='8 weeks ago' --pretty='%ad' --date=iso-strict \
  | cut -c1-10 | sort | uniq -c
```

### Observed results (as of 2025-12-09)
- Total 8 weeks: **262 commits** ⇒ average ~33 commits/week.
- One-time peak (10/14): 43 commits/day (likely batch).
- Heterogeneous distribution; be cautious about average commit size (not measured here).

### Conservative capacity reading
- Empirical base: ~33 commits/week. For realistic planning, use **~24–26 commits/week** (buffer for unplanned work/QA).
- Target incremental rhythm: 1 end‑to‑end increment (back+front) delivered every 1–2 weeks.

### Reproducibility
- Re-run the commands above after each sprint to adjust capacity.
- Future option: measure “changeset size” (lines added/removed) and average PR duration to refine.

