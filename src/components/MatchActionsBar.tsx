"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  deleteMatch,
  updateMatchClub,
  updateMatchMinShots,
} from "@/app/[locale]/(app)/matches/[id]/actions";
import type { Club } from "@/lib/db/types";

interface MatchActionsBarProps {
  matchId: string;
  /** Region actual del match, ej "ARG-TFALP", "TFALP", o un texto libre. */
  currentRegion: string | null;
  /** Code del club detectado en el region actual, null si no se mapeó al catálogo. */
  currentClubCode: string | null;
  /**
   * Disparos mínimos actuales del match. Null si nunca se completó
   * (admin/importer lo carga desde el form acá). FBI viene seteado en 45
   * por el importer.
   */
  currentMinShots: number | null;
  clubs: Club[];
  /** True si el usuario actual es el importador del match. */
  isImporter: boolean;
  /** True si el usuario actual es admin del sitio. */
  isAdmin: boolean;
  /**
   * Ruta desde donde llegó el usuario al detalle (ej "/matches" o
   * "/dashboard"). Se pasa a la action de delete para que devuelva al
   * usuario al mismo listado del que vino. Ya viene validada por la page.
   */
  from?: string;
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
  currentMinShots,
  clubs,
  isImporter,
  isAdmin,
  from,
}: MatchActionsBarProps) {
  // Tres estados mutuamente excluyentes: "reposo", "editando club",
  // "editando min_shots". Lo modelamos como un mode único en lugar de dos
  // booleanos para que abrir uno cierre el otro automáticamente.
  const [mode, setMode] = useState<"idle" | "club" | "minShots">("idle");
  const t = useTranslations("matches.actions");

  if (mode === "club") {
    return (
      <ClubForm
        matchId={matchId}
        currentRegion={currentRegion}
        currentClubCode={currentClubCode}
        clubs={clubs}
        onCancel={() => setMode("idle")}
      />
    );
  }

  if (mode === "minShots") {
    return (
      <MinShotsForm
        matchId={matchId}
        currentMinShots={currentMinShots}
        onCancel={() => setMode("idle")}
      />
    );
  }

  // Importer and admin have the same authority over the match — club,
  // min_shots and deletion. The club and delete buttons used to render on
  // `isImporter` alone, so an admin reaching this bar (the page renders it
  // via `canEditMatch`) found one action out of three. See issue #197.
  const canEdit = isImporter || isAdmin;

  return (
    // justify-end recuesta los botones contra el borde derecho del header,
    // matcheando la posición que naturalmente tienen "Guardar/Cancelar" en
    // el estado de edición (allá los empuja el Select que ocupa flex-1).
    // Sin esto, en reposo flotan a la izquierda y se sienten desconectados.
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canEdit && (
        <Button variant="ghost" size="sm" onClick={() => setMode("club")}>
          {currentRegion ? t("editClub") : t("assignClub")}
        </Button>
      )}
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode("minShots")}
          title={t("minShotsTooltip")}
        >
          {currentMinShots != null
            ? t("minimum", { count: currentMinShots })
            : t("defineMinimum")}
        </Button>
      )}
      {canEdit && <DeleteButton matchId={matchId} from={from} />}
    </div>
  );
}

/**
 * Eliminar match con confirmación inline de dos clicks:
 *  1. Click → el botón cambia a "¿Confirmar?" con fondo rojo lleno y se
 *     queda "armado". No se envía nada todavía.
 *  2. Click otra vez (en el mismo botón) → ahora el form se envía.
 *
 * Salvavidas para que el estado armado no quede sentado esperando un
 * misclick más tarde:
 *  - Auto-revert a los 4s.
 *  - Escape también cancela.
 *
 * No usamos `window.confirm()` porque es feo y rompe la estética del
 * resto de la app; no usamos un Dialog modal porque hoy este es el único
 * punto destructivo y un modal sería sobre-ingeniería.
 */
function DeleteButton({
  matchId,
  from,
}: {
  matchId: string;
  from?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  return (
    <form action={deleteMatch}>
      <input type="hidden" name="match_id" value={matchId} />
      {from && <input type="hidden" name="from" value={from} />}
      <DeleteSubmit armed={armed} onArm={() => setArmed(true)} />
    </form>
  );
}

/**
 * Botón submit del form de eliminar. Separado porque `useFormStatus` solo
 * funciona dentro de un `<form>`, y queremos mostrar "Eliminando…" mientras
 * la action está en flight.
 */
function DeleteSubmit({
  armed,
  onArm,
}: {
  armed: boolean;
  onArm: () => void;
}) {
  const { pending } = useFormStatus();
  const t = useTranslations("matches.actions");
  return (
    <Button
      type="submit"
      variant="danger"
      size="sm"
      // Si NO está armed, interceptamos el click para armar en lugar de
      // submitear. Si ya está armed (o pending), dejamos pasar.
      onClick={
        armed || pending
          ? undefined
          : (e) => {
              e.preventDefault();
              onArm();
            }
      }
      disabled={pending}
      aria-busy={pending}
      // En estado armed pasamos a rojo lleno para que el cambio sea bien
      // visible — el outline rojo solo no comunica suficiente "ojo, el
      // próximo click sí borra".
      className={
        armed
          ? "bg-danger text-bg border-danger hover:bg-danger"
          : undefined
      }
    >
      {pending ? t("deleting") : armed ? t("confirm") : t("delete")}
    </Button>
  );
}

/**
 * Its own props, not `MatchActionsBarProps & { onCancel }`. Inheriting the
 * parent's type forced the call site to pass `currentMinShots`,
 * `isImporter` and `isAdmin`, which this form never used: dead props the
 * compiler won't flag, because the type declares them.
 */
interface ClubFormProps {
  matchId: string;
  currentRegion: string | null;
  currentClubCode: string | null;
  clubs: Club[];
  onCancel: () => void;
}

function ClubForm({
  matchId,
  currentRegion,
  currentClubCode,
  clubs,
  onCancel,
}: ClubFormProps) {
  const t = useTranslations("matches.actions");
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
          label={t("club")}
          name="club_code"
          value={clubCode}
          onChange={(e) => setClubCode(e.target.value)}
        >
          <option value="">{t("unassigned")}</option>
          {clubs.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
              {c.country ? ` (${c.country})` : ""}
            </option>
          ))}
          <option value="OTHER">{t("other")}</option>
        </Select>
      </div>

      {isOther && (
        <div className="min-w-0 sm:flex-1 sm:min-w-[200px]">
          <Input
            label={t("clubName")}
            name="custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t("clubNamePlaceholder")}
            required
          />
        </div>
      )}

      <FormButtons onCancel={onCancel} />
    </form>
  );
}

/**
 * Form de "disparos mínimos" del match (issue #75). Input numérico simple.
 * Vacío limpia el campo (NULL); admin puede usarlo para resetear un valor
 * mal cargado. Server action valida que el usuario sea importer o admin.
 */
function MinShotsForm({
  matchId,
  currentMinShots,
  onCancel,
}: {
  matchId: string;
  currentMinShots: number | null;
  onCancel: () => void;
}) {
  const t = useTranslations("matches.actions");
  const [value, setValue] = useState<string>(
    currentMinShots != null ? String(currentMinShots) : "",
  );

  // El hint va FUERA del Input y debajo de toda la fila (no como prop) para
  // que el `items-end` del flex alinee los botones con el bottom del input,
  // no con el bottom del hint. Sin esto, los botones quedan empujados ~20px
  // hacia abajo respecto del input — visible como desalineamiento.
  return (
    <form action={updateMatchMinShots} className="w-full space-y-2">
      <input type="hidden" name="match_id" value={matchId} />

      <div className="space-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0">
        <div className="min-w-0 sm:flex-1 sm:min-w-[220px]">
          <Input
            label={t("minShotsLabel")}
            name="min_shots"
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("minShotsPlaceholder")}
          />
        </div>
        <FormButtons onCancel={onCancel} />
      </div>

      <p className="text-xs text-fg-subtle">
        {t("minShotsHint")}
      </p>
    </form>
  );
}

/**
 * Buttons shared by both forms. A sub-component so it can read
 * `useFormStatus`, which only works inside a `<form>`. While the action is
 * in flight:
 *  - "Save" shows a spinner plus "Saving…" and goes disabled
 *  - "Cancel" goes disabled too, so the user can't hide the form
 *    mid-update and end up unsure whether it saved
 *
 * `size="md"` (h-10) makes both buttons match the Select's height (also
 * h-10), keeping the form aligned on a single visual line. "Cancel" uses
 * `variant="secondary"` (border + soft bg) rather than `ghost`: next to
 * the solid orange Save, ghost reads as weightless text; secondary
 * balances it without competing.
 */
function FormButtons({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  const t = useTranslations("matches.actions");
  return (
    <div className="flex gap-2">
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("saving")}
          </>
        ) : (
          t("save")
        )}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={onCancel}
        disabled={pending}
      >
        {t("cancel")}
      </Button>
    </div>
  );
}
