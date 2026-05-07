"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { updateMatchClub } from "@/app/(app)/matches/[id]/actions";
import type { Club } from "@/lib/db/types";

interface EditClubButtonProps {
  matchId: string;
  /** Region actual del match, ej "ARG-TFALP", "TFALP", o un texto libre. */
  currentRegion: string | null;
  /** Code del país detectado en el region actual (ej "ARG"), null si no se detectó. */
  currentCountry: string | null;
  /** Code del club detectado, null si no se mapeó al catálogo. */
  currentClubCode: string | null;
  clubs: Club[];
}

/**
 * Botón "Editar club" + form inline para que el importador especifique a qué
 * club se llevó a cabo el match. Útil cuando los datos importados no incluyen
 * la región (típico FBI).
 *
 * El select se popula desde la tabla `clubs` (ver db/clubs.ts). La opción
 * "Otro..." habilita un input free-text para clubs no listados.
 */
export function EditClubButton({
  matchId,
  currentRegion,
  currentCountry,
  currentClubCode,
  clubs,
}: EditClubButtonProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {currentRegion ? "Editar club" : "Asignar club"}
      </Button>
    );
  }

  return (
    <ClubForm
      matchId={matchId}
      currentRegion={currentRegion}
      currentCountry={currentCountry}
      currentClubCode={currentClubCode}
      clubs={clubs}
      onCancel={() => setOpen(false)}
    />
  );
}

function ClubForm({
  matchId,
  currentRegion,
  currentCountry,
  currentClubCode,
  clubs,
  onCancel,
}: EditClubButtonProps & { onCancel: () => void }) {
  // Estado inicial: si el club actual está en el catálogo, lo preseleccionamos.
  // Si no está pero hay un texto, arrancamos en "Otro..." con ese texto.
  const knownCodes = new Set(clubs.map((c) => c.code));
  const initialCodeIsKnown =
    currentClubCode != null && knownCodes.has(currentClubCode);

  const [clubCode, setClubCode] = useState<string>(
    initialCodeIsKnown ? currentClubCode! : currentRegion ? "OTHER" : "",
  );
  const [country, setCountry] = useState<string>(currentCountry ?? "ARG");
  const [custom, setCustom] = useState<string>(
    initialCodeIsKnown ? "" : currentRegion ?? "",
  );

  const isOther = clubCode === "OTHER";
  const isCleared = clubCode === "";

  return (
    <form action={updateMatchClub} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="country" value={country} />

      <div className="min-w-[200px]">
        <Select
          label="Club"
          name="club_code"
          value={clubCode}
          onChange={(e) => setClubCode(e.target.value)}
        >
          <option value="">— Sin asignar —</option>
          {clubs.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
          <option value="OTHER">Otro…</option>
        </Select>
      </div>

      {isOther && (
        <div className="min-w-[180px]">
          <Input
            label="Nombre del club"
            name="custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Ej: Club Tiro XYZ"
            required
          />
        </div>
      )}

      {!isOther && !isCleared && (
        <div className="w-24">
          <Input
            label="País"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            placeholder="ARG"
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Guardar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
