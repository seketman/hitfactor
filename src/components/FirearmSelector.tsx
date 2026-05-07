"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { setMatchFirearm } from "@/lib/actions/firearms";
import type { Firearm, MatchFirearmLog } from "@/lib/db/types";

interface FirearmSelectorProps {
  matchEntryId: string;
  matchId: string;
  firearms: Firearm[];
  current: MatchFirearmLog | null;
  /** Tiros estimados según disciplina/stages. Null = no se puede estimar. */
  suggestedRounds: number | null;
}

/**
 * Card en /matches/[id]/me para asignar el arma usada en este match.
 *
 * Si el usuario no tiene armas cargadas todavía, mostramos un CTA al
 * catálogo. Si tiene, dropdown + número de tiros (pre-fill con el
 * estimado o con el valor ya guardado).
 */
export function FirearmSelector({
  matchEntryId,
  matchId,
  firearms,
  current,
  suggestedRounds,
}: FirearmSelectorProps) {
  if (firearms.length === 0) {
    return (
      <Card className="mb-8 px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          Arma usada
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Todavía no cargaste ninguna arma en tu catálogo.{" "}
          <Link href="/firearms" className="text-accent hover:underline">
            Agregá la primera
          </Link>{" "}
          y volvé acá para asignarla a este match.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mb-8 px-5 py-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-muted">
        Arma usada
      </p>
      {/*
        key={matchEntryId} fuerza remount cuando cambia la entry (ej: el
        usuario salta entre divisiones del mismo match con el DivisionSelector).
        Sin esto, los useState internos retienen el firearmId/rounds de la
        división anterior y el form muestra valores que no corresponden a la
        entry actual.
      */}
      <FirearmForm
        key={matchEntryId}
        matchEntryId={matchEntryId}
        matchId={matchId}
        firearms={firearms}
        current={current}
        suggestedRounds={suggestedRounds}
      />
    </Card>
  );
}

function FirearmForm({
  matchEntryId,
  matchId,
  firearms,
  current,
  suggestedRounds,
}: FirearmSelectorProps) {
  const initialFirearmId = current?.firearm_id ?? "";
  const initialRounds =
    current?.rounds_fired ?? suggestedRounds ?? 0;

  const [firearmId, setFirearmId] = useState<string>(initialFirearmId);
  const [rounds, setRounds] = useState<string>(String(initialRounds));

  const isClearing = !firearmId;

  return (
    <form action={setMatchFirearm} className="space-y-3">
      <input type="hidden" name="match_entry_id" value={matchEntryId} />
      <input type="hidden" name="match_id" value={matchId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Arma"
          name="firearm_id"
          value={firearmId}
          onChange={(e) => setFirearmId(e.target.value)}
        >
          <option value="">— Sin asignar —</option>
          {firearms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.caliber ? ` (${f.caliber})` : ""}
            </option>
          ))}
        </Select>

        <Input
          label="Tiros disparados"
          name="rounds_fired"
          type="number"
          min={0}
          value={rounds}
          onChange={(e) => setRounds(e.target.value)}
          disabled={isClearing}
          hint={
            !isClearing && suggestedRounds !== null && !current
              ? `estimado: ${suggestedRounds}`
              : undefined
          }
        />
      </div>

      <Button type="submit" size="sm">
        {current ? "Actualizar" : isClearing ? "Confirmar" : "Guardar"}
      </Button>
    </form>
  );
}
