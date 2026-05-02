"use client";

import { useActionState, useState } from "react";
import { createCharacterAction, type OnboardingState } from "./actions";
import type { Profession } from "@/lib/types/game.types";

interface CityOption {
  id: number;
  name: string;
  description: string | null;
}

interface ProfessionOption {
  id: Profession;
  label: string;
  blurb: string;
}

interface Props {
  professions: ProfessionOption[];
  cities: CityOption[];
}

const initialState: OnboardingState = { error: null };

export default function OnboardingForm({ professions, cities }: Props) {
  const [profession, setProfession] = useState<Profession>(professions[0].id);
  const [cityId, setCityId] = useState<number | null>(cities[0]?.id ?? null);
  const [state, formAction, isPending] = useActionState(
    createCharacterAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-10">
      {/* Name */}
      <section className="panel">
        <h2 className="panel-heading">1 · Name yourself</h2>
        <div className="panel-body">
          <label className="label-imperial" htmlFor="name">
            Character name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={32}
            className="input-imperial"
            placeholder="Constantine of Adrianople"
          />
          <p className="mt-1 text-xs text-parchment-deep/70">
            2–32 characters. This is what others will see in the world.
          </p>
        </div>
      </section>

      {/* Profession */}
      <section className="panel">
        <h2 className="panel-heading">2 · Choose a calling</h2>
        <div className="panel-body grid gap-3 sm:grid-cols-2">
          {professions.map((p) => (
            <label
              key={p.id}
              className={`cursor-pointer rounded-sm border p-4 transition ${
                profession === p.id
                  ? "border-gold bg-imperial/40 shadow-seal"
                  : "border-gold/15 hover:border-gold/40"
              }`}
            >
              <input
                type="radio"
                name="profession"
                value={p.id}
                className="sr-only"
                checked={profession === p.id}
                onChange={() => setProfession(p.id)}
              />
              <div className="font-display uppercase tracking-imperial text-sm text-gold-bright">
                {p.label}
              </div>
              <p className="mt-2 font-serif text-sm text-parchment-dark">
                {p.blurb}
              </p>
            </label>
          ))}
        </div>
      </section>

      {/* Starting city */}
      <section className="panel">
        <h2 className="panel-heading">3 · Pick your hearth</h2>
        <div className="panel-body space-y-3">
          {cities.length === 0 ? (
            <p className="font-serif italic text-blood">
              No cities have been seeded yet. Ask an administrator to seed
              the world before continuing.
            </p>
          ) : (
            cities.map((c) => (
              <label
                key={c.id}
                className={`flex cursor-pointer items-start gap-4 rounded-sm border p-4 transition ${
                  cityId === c.id
                    ? "border-gold bg-imperial/40 shadow-seal"
                    : "border-gold/15 hover:border-gold/40"
                }`}
              >
                <input
                  type="radio"
                  name="city_id"
                  value={c.id}
                  className="sr-only"
                  checked={cityId === c.id}
                  onChange={() => setCityId(c.id)}
                />
                <div className="flex-1">
                  <div className="font-display uppercase tracking-imperial text-sm text-gold-bright">
                    {c.name}
                  </div>
                  {c.description ? (
                    <p className="mt-1 font-serif text-sm text-parchment-dark">
                      {c.description}
                    </p>
                  ) : null}
                </div>
              </label>
            ))
          )}
        </div>
      </section>

      {state.error ? (
        <p className="text-blood font-serif italic">{state.error}</p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending || cities.length === 0}
          className="btn-imperial"
        >
          {isPending ? "Forging…" : "Begin"}
        </button>
      </div>
    </form>
  );
}
