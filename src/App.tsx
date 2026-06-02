import { useState } from "react";
import { parseTrackFile, parseTrackFromBuffer } from "./lib/trackUtils";
import type { Tracks } from "./lib/trackUtils";
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
  return (
    <div className="mx-auto max-w-5xl px-2 pb-6 sm:px-4 sm:pb-8">
      <header className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-tight">
            Running analysis
          </h1>
        </div>
      </header>

      {tracks && <ChartCard tracks={tracks} />}
      {tracks && <TableCard tracks={tracks} />}

      <UploadCard
        drive={drive}
        tracks={tracks}
        error={error}
        onFile={handleFile}
      />
    </div>
  );
}
