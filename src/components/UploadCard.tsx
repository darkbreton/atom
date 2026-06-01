import type { ChangeEvent, DragEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UseDriveResult } from "@/lib/useDrive";
import type { Tracks } from "@/lib/trackUtils";

interface UploadCardProps {
  drive: UseDriveResult;
  tracks: Tracks | null;
  error: string;
  onFile: (file: File) => void | Promise<void>;
}

export function UploadCard({ drive, tracks, error, onFile }: UploadCardProps) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) void onFile(file);
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Upload track</CardTitle>
        <CardDescription>
          Pull a recent run from Google Drive, or drop a GPX/FIT file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md bg-background/40 p-4 ring-1 ring-foreground/10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Google Drive</div>
              {!drive.configured && (
                <div className="text-sm text-muted-foreground">
                  Drive disabled — set VITE_GOOGLE_* in .env.local
                </div>
              )}
            </div>
            {drive.configured && drive.token && (
              <Button type="button" variant="outline" onClick={drive.signOut}>
                Sign out
              </Button>
            )}
          </div>

          {drive.configured && !drive.token && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={drive.signIn}
              disabled={drive.status === "signing-in"}
            >
              {drive.status === "signing-in"
                ? "Signing in…"
                : "Sign in with Google"}
            </Button>
          )}

          {drive.configured &&
            drive.token &&
            drive.files.length === 0 &&
            drive.status === "listing" && (
              <div className="text-sm text-muted-foreground">
                Loading files…
              </div>
            )}

          {drive.configured &&
            drive.token &&
            drive.status === "ready" &&
            drive.files.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No FIT files in this folder yet.
              </div>
            )}

          {drive.configured && drive.token && drive.files.length > 0 && (
            <>
              <div className="text-sm text-muted-foreground">
                {drive.status === "listing"
                  ? `Loading more… (${drive.files.length})`
                  : `${drive.files.length} files`}
              </div>
              <ul className="mt-2 flex max-h-[420px] list-none flex-col gap-1.5 overflow-y-auto p-0">
                {drive.files.map((file) => {
                  const isCurrent = tracks?.fileName === file.name;
                  const isLoading = drive.loadingId === file.id;
                  return (
                    <li
                      key={file.id}
                      className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ring-1 ${
                        isCurrent
                          ? "bg-primary/10 ring-primary/50"
                          : "bg-card/70 ring-foreground/5"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{file.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(file.modifiedTime).toLocaleString()}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => drive.loadFile(file)}
                        disabled={isLoading}
                      >
                        {isLoading ? "Loading…" : isCurrent ? "Reload" : "Load"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {drive.error && (
            <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/15 px-4 py-3 text-sm text-red-200">
              {drive.error}
            </div>
          )}
        </div>

        <div className="my-3 flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
          <span>or</span>
        </div>

        <div
          className="relative flex min-h-40 items-center justify-center rounded-md border-2 border-dashed border-primary/35 bg-background/40 p-7 text-center"
          onDragOver={(event: DragEvent<HTMLDivElement>) =>
            event.preventDefault()
          }
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) void onFile(file);
          }}
        >
          <label
            htmlFor="track-file"
            className="block w-full cursor-pointer font-semibold"
          >
            {tracks
              ? "Fichier chargé : " + tracks.fileName
              : "Choisissez un GPX/.FIT ou glissez-le ici"}
          </label>
          <input
            id="track-file"
            type="file"
            accept=".gpx,.fit"
            onChange={handleFileChange}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/15 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
