"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  deleteMatch,
  updateMatchClub,
} from "@/app/(app)/matches/[id]/actions";
import type { Club } from "@/lib/db/types";

interface MatchActionsBarProps {
  matchId: string;
  /** Region actual del match, ej "ARG-TFALP", "TFALP", o un texto libre. */
  currentRegion: string | null;
  /** Code del club detectado en el region actual, null si no se mapeó al catálogo. */
  currentClubCode: string | null;
  clubs: Club[];
}

/**
 * Barra de acciones del importador en el detalle de un match. Coordina los
 * dos posibles estados:
 *
 *  - **Reposo**: muestra los botones "Editar club" y "Eliminar" en línea.
 *  - **Editando club**: oculta los botones y reemplaza por el form. Cuando
 *    se guarda o cancela, vuelve al estado de reposo.
 *
 * Tener este toggle centralizado evita que el form se renderice apretado al
 * lado de "Eliminar" y rompa el wrapping en mobile.
 */
export function MatchActionsBar({
  matchId,
  currentRegion,
  currentClubCode,
  clubs,
}: MatchActionsBarProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ClubForm
        matchId={matchId}
        currentRegion={currentRegion}
        currentClubCode={currentClubCode}
        clubs={clubs}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        {currentRegion ? "Editar club" : "Asignar club"}
      </Button>
      <form action={deleteMatch}>
        <input type="hidden" name="match_id" value={matchId} />
        <Button type="submit" variant="danger" size="sm">
          Eliminar
        </Button>
      </form>
    </div>
  );
}

function ClubForm({
  matchId,
  currentRegion,
  currentClubCode,
  clubs,
  onCancel,
}: MatchActionsBarProps & { onCancel: () => void }) {
  // Estado inicial: si el club actual está en el catálogo, lo preseleccionamos.
  // Si no está pero hay un texto, arrancamos en "Otro..." con ese texto.
  const knownCodes = new Set(clubs.map((c) => c.code));
  const initialCodeIsKnown =
    currentClubCode != null && knownCodes.has(currentClubCode);

  const [clubCode, setClubCode] = useState<string>(
    initialCodeIsKnown ? currentClubCode! : currentRegion ? "OTHER" : "",
  );
  const [custom, setCustom] = useState<string>(
    initialCodeIsKnown ? "" : currentRegion ?? "",
  );

  // País derivado del club seleccionado (atributo del club, no del torneo).
  const selectedClub = clubs.find((c) => c.code === clubCode);
  const country = selectedClub?.country ?? "";

  const isOther = clubCode === "OTHER";

  return (
    <form
      action={updateMatchClub}
      className="w-full space-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0"
    >
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="country" value={country} />

      <div className="min-w-0 sm:flex-1 sm:min-w-[220px]">
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
              {c.country ? ` (${c.country})` : ""}
            </option>
          ))}
          <option value="OTHER">Otro…</option>
        </Select>
      </div>

      {isOther && (
        <div className="min-w-0 sm:flex-1 sm:min-w-[200px]">
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
