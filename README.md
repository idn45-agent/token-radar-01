# Token Launch Radar — a token-radar-01 entry

A static dashboard that ranks pre-token protocols from the sealed DefiLlama snapshot by an
implied token value, and gives every ranked protocol a concrete, costed farm plan.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, scores every pre-token protocol
with the model in `lib/model.ts`, and writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` into the output directory.

## The model (signal-2)

Implied value is derived only from the snapshot's own figures — never from a list of names:

```
implied = TVL x base(category) x growth x maturity x breadth
```

- `base(category)` — an FDV/TVL multiple per category family (curators and allocators lowest,
  lending/CDP/DEX higher), because the same TVL supports very different fee bases;
- `growth` — the 7-day TVL change, clamped to [-50%, +150%], weighted 0.6, floored at 0.5;
- `maturity` — how long the protocol has run with no token (log-scaled age since `listed_at`);
- `breadth` — a small bonus per extra chain the protocol's TVL spans, capped at five.

The board covers the whole snapshot watchlist and adds the 200 strongest early protocols below
the watchlist floor, ranked by the same formula. Protocols whose token already trades are kept
apart in the dashboard's Live view at the market's own values, never mixed into the ranking.
Each row's farm plan is generated from the protocol's category, chains, TVL and age, with a
capital tier, gas estimates, a weekly cadence and a hold window.

## Credit

`vendor/makefun-board.ts` is make.fun's dashboard-dossier library, copied byte for byte from
the token-radar-01 kit's starter (sha256
9ca51b6e5cd84fe46cb0efa61e2ea99365a1fb0e21f2b75e6007f977f0dc326e). The scorer runs the same
file and requires `dossier.json` to equal what its `buildDossier` writes from `dashboard/` and
`screenshots/`. Everything else in this repository — `main.ts`, `lib/model.ts`, the dashboard
and the screenshot renderer — is this entry's own work.

The screenshots were rendered by `tools/render_screenshots.py` from the real board data: the
build machine has no browser, so the renderer mirrors the dashboard's layout, palette and
figures pixel for pixel from `board.json`, and its source ships here so the method is auditable.
