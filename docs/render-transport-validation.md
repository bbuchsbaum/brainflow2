# Render transport validation

This replaces the two root binary-IPC guides. Their
[`apply_and_render_view_state_binary` examples and timing estimates](../memory-bank/archive/root-cleanup-2026-10-25/README.md)
are historical. Log emoji, a console toggle or a fixed latency cutoff is not
evidence that the current renderer used the intended transport.

## Current entry points

[`RenderClient`](../packages/api/src/renderClient.ts) calls `render_view`,
`render_views` and `submit_view`; the
[command list](../core/api_bridge/src/command_list.rs) defines the exposed bridge
surface. The client normalizes binary responses and decodes PNG or raw RGBA
packets, including the multi-view envelope. The
[UI API service](../ui2/src/services/apiService.ts) chooses the format and records
render diagnostics. A binary response avoids representing image bytes as a JSON
number array; it does not by itself establish zero-copy delivery end to end.

## Checks

Run from the repository root:

```sh
# Packet validation and client contract checks (mock transport)
pnpm --filter temp-ui exec vitest run src/services/__tests__/renderClient.test.ts

# GPU output equality, owned async readback and unchanged visual baseline;
# require a usable adapter
cargo test -p render_loop --test batch_readback_test --test async_readback_test \
  --test render_golden_test

# Native integration
pnpm dev
```

In the native app, load a deterministic fixture, inspect an orthogonal view and
exercise resizing and multiple panes. Record the actual command and format,
decoded dimensions, payload bytes and failures, together with the revision,
fixture, viewport and adapter. Separate mocked packet checks, GPU readback
checks and native presentation evidence. A GPU skip does not qualify rendering.

For performance comparisons, hold the fixture and display settings fixed and
measure both cold and warm runs. Separate GPU work/readback, encoding, IPC,
decoding and presentation where diagnostics permit. Record failure/fallback
behavior as well as timings. Do not reuse the old guides' 1.5–10× predictions
or infer transport choice from an 8 ms versus 25 ms example.
