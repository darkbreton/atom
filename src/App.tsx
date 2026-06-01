import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  intervalOptions,
  buildFitIntervals,
  splitIntervals,
  parseTrackFile,
  parseTrackFromBuffer,
} from "./lib/trackUtils";
import type { IntervalOption, IntervalRow, Tracks } from "./lib/trackUtils";
import { useDrive } from "./lib/useDrive";
import { ChartCard } from "@/components/ChartCard";
import { TableCard } from "@/components/TableCard";
import { UploadCard } from "@/components/UploadCard";

const DRIVE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  | string
  | undefined;
const DRIVE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const DRIVE_FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID as
  | string
  | undefined;

export default function App() {
  const [error, setError] = useState<string>("");
  const [tracks, setTracks] = useState<Tracks | null>(null);
  const [intervalOption, setIntervalOption] = useState<IntervalOption>(
    intervalOptions.find((option) => option.type === "auto") ||
      intervalOptions[0],
  );

  const loadTracksFromBuffer = async (
    bytes: ArrayBuffer,
    fileName: string,
  ): Promise<void> => {
    setError("");
    try {
      setTracks(await parseTrackFromBuffer(bytes, fileName));
    } catch (err) {
      setTracks(null);
      setError(
        err instanceof Error ? err.message : "Erreur de lecture du fichier.",
      );
    }
  };

  const drive = useDrive({
    clientId: DRIVE_CLIENT_ID,
    apiKey: DRIVE_API_KEY,
    folderId: DRIVE_FOLDER_ID,
    onFileBytes: loadTracksFromBuffer,
  });

  const handleFile = async (file: File): Promise<void> => {
    setError("");
    try {
      setTracks(await parseTrackFile(file));
    } catch (err) {
      setTracks(null);
      setError(
        err instanceof Error ? err.message : "Erreur de lecture du fichier.",
      );
    }
  };

  const tableIntervalRows: IntervalRow[] = useMemo(() => {
    if (!tracks) return [];
    if (tracks.fitLaps.length > 0 && intervalOption.type === "auto") {
      return buildFitIntervals(tracks.points, tracks.segments, tracks.fitLaps);
    }
    return splitIntervals(tracks.segments, intervalOption);
  }, [tracks, intervalOption]);

  return (
    <div className="mx-auto max-w-5xl px-2 pb-6 sm:px-4 sm:pb-8">
      <header className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            GPX + FIT interval analysis
          </p>
          <h1 className="text-2xl font-semibold leading-tight">
            Condensed running analysis
          </h1>
        </div>
        <Badge variant="secondary">Mobile-friendly</Badge>
      </header>

      {tracks ? (
        <>
          <ChartCard tracks={tracks} />
          <TableCard
            intervalOption={intervalOption}
            onIntervalOptionChange={setIntervalOption}
            rows={tableIntervalRows}
          />
        </>
      ) : null}

      <UploadCard
        drive={drive}
        tracks={tracks}
        error={error}
        onFile={handleFile}
      />
    </div>
  );
}
