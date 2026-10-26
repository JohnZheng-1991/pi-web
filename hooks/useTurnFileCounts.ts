"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getTurnDiffUrl, type TurnDiffCounts, type TurnDiffRef } from "@/lib/turn-diff";
import type { WrittenFile } from "@/lib/turn-written-files";

/**
 * A turn's changed files, from the server: its git baseline compared with the
 * working tree, so the list holds every file it touched — a shell command's or a
 * subagent's writes included — with each count being that turn's net change,
 * exactly the patch the row opens.
 *
 * Null keeps the chat's own list, for a turn with no baseline (a folder that is
 * not a repository, or one recorded before baselines existed). It shows paths
 * without numbers rather than a number that does not match its diff.
 */
export function useTurnFileCounts(files: WrittenFile[], turn: TurnDiffRef | undefined): WrittenFile[] | null {
  const url = turn ? getTurnDiffUrl(turn) : undefined;
  const [listed, setListed] = useState<{ url: string; files: WrittenFile[] } | null>(null);
  // The effect keys on the URL alone: a turn ref rebuilt each render would
  // otherwise refetch the same answer on every render of the chat.
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null) as Promise<TurnDiffCounts[] | null>)
      .then((results) => {
        if (!results || controller.signal.aborted) return;
        // No baseline: the caller keeps the transcript's own list.
        if (results.length === 0) return;
        setListed({
          url,
          files: results.map((count) => ({
            filePath: count.path,
            toolCallIds: [],
            ...(count.supported ? { additions: count.additions, deletions: count.deletions } : {}),
          })),
        });
      })
      .catch(() => {
        // No baseline, no numbers: the card stays useful without them.
      });
    return () => controller.abort();
  }, [url]);

  return useMemo(() => {
    if (!url) return null;
    if (listed?.url !== url) return files;
    // The server's list is the turn's: it has each file's net counts and the
    // writes the transcript cannot see (a shell command, a subagent). The
    // transcript adds only files the server left out (written outside the cwd).
    const listedPaths = new Set(listed.files.map((file) => file.filePath));
    return [...listed.files, ...files.filter((file) => !listedPaths.has(file.filePath))];
  }, [files, listed, url]);
}
