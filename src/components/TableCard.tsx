import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  intervalOptions,
  formatDuration,
  formatNumber,
  formatPace,
  buildFitIntervals,
  splitIntervals,
} from "@/lib/trackUtils";
import type { IntervalOption, IntervalRow, Tracks } from "@/lib/trackUtils";
import { useMemo, useState } from "react";

interface TableCardProps {
  tracks: Tracks;
}

export function TableCard({ tracks }: TableCardProps) {
  const [showTable, setShowTable] = useState(false);
  const [intervalOption, setIntervalOption] = useState<IntervalOption>(
    intervalOptions.find((option) => option.type === "laps") ||
      intervalOptions[0],
  );

  const rows: IntervalRow[] = useMemo(() => {
    if (!tracks) return [];
    if (tracks.fitLaps.length > 0 && intervalOption.type === "laps") {
      return buildFitIntervals(tracks.points, tracks.segments, tracks.fitLaps);
    }
    return splitIntervals(tracks.segments, intervalOption);
  }, [tracks, intervalOption]);

  const intervalDistance = rows.reduce((acc, row) => acc + row.distance, 0);
  const intervalDuration = rows.reduce((acc, row) => acc + row.duration, 0);
  const totalPace =
    intervalDistance > 0 ? intervalDuration / (intervalDistance / 1000) : NaN;
  const totalGap =
    intervalDistance > 0
      ? rows.reduce((acc, row) => acc + row.gap * row.distance, 0) /
        intervalDistance
      : NaN;
  const totalHr =
    rows.reduce(
      (acc, row) =>
        acc + (Number.isFinite(row.avgHr) ? row.avgHr * row.duration : 0),
      0,
    ) /
    Math.max(
      1,
      rows.reduce(
        (acc, row) => acc + (Number.isFinite(row.avgHr) ? row.duration : 0),
        0,
      ),
    );

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">Table</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowTable((showTable) => !showTable)}
          >
            {showTable ? "Hide table" : "Show table"}
          </Button>
        </div>
      </CardHeader>

      {showTable ? (
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="interval">Mode</Label>
            <Select
              value={intervalOption.label}
              onValueChange={(value) =>
                setIntervalOption(
                  intervalOptions.find((option) => option.label === value) ||
                    intervalOptions[0],
                )
              }
            >
              <SelectTrigger id="interval" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervalOptions.map((option) => (
                  <SelectItem key={option.label} value={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-xl">
              <TableHeader>
                <TableRow>
                  <TableHead>Interval</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Distance</TableHead>
                  <TableHead>Pace</TableHead>
                  <TableHead>GAP</TableHead>
                  <TableHead>Gain</TableHead>
                  <TableHead>Avg HR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.index}>
                    <TableCell>{row.index}</TableCell>
                    <TableCell>{formatDuration(row.duration)}</TableCell>
                    <TableCell>
                      {formatNumber(row.distance / 1000, 2)} km
                    </TableCell>
                    <TableCell>{formatPace(row.pace)}</TableCell>
                    <TableCell>{formatPace(row.gap)}</TableCell>
                    <TableCell>
                      {formatNumber(row.elevationGain, 1)} m
                    </TableCell>
                    <TableCell>{formatNumber(row.avgHr, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell>{formatDuration(intervalDuration)}</TableCell>
                  <TableCell>
                    {formatNumber(intervalDistance / 1000, 2)} km
                  </TableCell>
                  <TableCell>{formatPace(totalPace)}</TableCell>
                  <TableCell>{formatPace(totalGap)}</TableCell>
                  <TableCell>
                    {formatNumber(
                      rows.reduce((acc, row) => acc + row.elevationGain, 0),
                      1,
                    )}{" "}
                    m
                  </TableCell>
                  <TableCell>{formatNumber(totalHr, 0)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
