// Blacksmith upgrade preview — shared by the Plaza forge and the creature Gear
// menu, which both let you climb a piece up its rarity ladder and both want the
// same old→new description read-out.

/**
 * A run of the upgraded description. `same` is unchanged carry-over text; a change
 * run instead carries `from`/`to` (either may be '' for a pure delete/insert).
 * One optional-field shape (not a union) so the template can read every field.
 */
export interface DescSeg {
  same?: string;
  from?: string;
  to?: string;
}

/**
 * Word-level diff of two gear descriptions for the Blacksmith upgrade preview.
 * Returns runs of the *new* description: unchanged text passes through, and any
 * span that differs becomes a `{from, to}` change so the UI can show e.g.
 * "50% → 60%" or highlight a freshly-added stat. Standard LCS backtrack; adjacent
 * deletes+inserts coalesce into one change so a bumped number reads as old→new.
 */
export function descDiff(a: string, b: string): DescSeg[] {
  const at = a.split(' ');
  const bt = b.split(' ');
  const n = at.length;
  const m = bt.length;
  // LCS length table (suffixes).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = at[i] === bt[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: { t: 'same' | 'del' | 'ins'; w: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at[i] === bt[j]) {
      ops.push({ t: 'same', w: bt[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', w: at[i++] });
    } else {
      ops.push({ t: 'ins', w: bt[j++] });
    }
  }
  while (i < n) ops.push({ t: 'del', w: at[i++] });
  while (j < m) ops.push({ t: 'ins', w: bt[j++] });

  // Coalesce adjacent ops into display segments.
  const segs: DescSeg[] = [];
  let sameBuf: string[] = [];
  let delBuf: string[] = [];
  let insBuf: string[] = [];
  const flushSame = () => {
    if (sameBuf.length) {
      segs.push({ same: sameBuf.join(' ') });
      sameBuf = [];
    }
  };
  const flushChange = () => {
    if (delBuf.length || insBuf.length) {
      segs.push({ from: delBuf.join(' '), to: insBuf.join(' ') });
      delBuf = [];
      insBuf = [];
    }
  };
  for (const op of ops) {
    if (op.t === 'same') {
      flushChange();
      sameBuf.push(op.w);
    } else {
      flushSame();
      (op.t === 'del' ? delBuf : insBuf).push(op.w);
    }
  }
  flushSame();
  flushChange();
  return segs;
}
