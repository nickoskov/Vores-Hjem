# Graph Report - voreshjem-site  (2026-06-03)

## Corpus Check
- 21 files · ~468,155 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 46 nodes · 31 edges · 20 communities (18 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `db()` - 4 edges
2. `isLoggedIn()` - 3 edges
3. `currentUser()` - 3 edges
4. `initSchema()` - 3 edges
5. `requireLogin()` - 2 edges
6. `PDO` - 2 edges
7. `configurations` - 1 edges
8. `timestamp` - 1 edges
9. `count` - 1 edges
10. `updated` - 1 edges

## Surprising Connections (you probably didn't know these)
- `currentUser()` --calls--> `db()`  [INFERRED]
  minbolighandel/admin/_auth.php → minbolighandel/admin/_db.php

## Import Cycles
- None detected.

## Communities (20 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.38
Nodes (3): currentUser(), isLoggedIn(), requireLogin()

### Community 2 - "Community 2"
Cohesion: 0.60
Nodes (3): db(), initSchema(), PDO

### Community 3 - "Community 3"
Cohesion: 0.50
Nodes (3): count, timestamp, updated

## Knowledge Gaps
- **6 isolated node(s):** `version`, `configurations`, `timestamp`, `count`, `updated` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `currentUser()` connect `Community 0` to `Community 2`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `db()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `version`, `configurations`, `timestamp` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._