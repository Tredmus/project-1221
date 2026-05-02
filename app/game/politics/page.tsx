import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDistanceToNow, format } from "date-fns";
import VoteForm from "@/components/politics/VoteForm";
import OpenElectionForm from "@/components/politics/OpenElectionForm";

export const metadata = {
  title: "Politics · Imperium",
};

export const revalidate = 60;

export default async function PoliticsPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  // The city/scope context: character's current city.
  const { data: city } = character.node_id
    ? await supabase
        .from("cities")
        .select("id, name, node_id")
        .eq("node_id", character.node_id)
        .maybeSingle()
    : { data: null };

  // All open elections.
  const { data: openElections } = await supabase
    .from("elections")
    .select("id, position_id, scope_id, closes_at")
    .eq("status", "open")
    .order("closes_at");

  // Current officeholders (active terms, most recent first per position+scope).
  const { data: officeholders } = await supabase
    .from("officeholders")
    .select(`
      id, position_id, scope_id, term_start, term_end,
      character:characters ( id, name, profession )
    `)
    .gte("term_end", new Date().toISOString().slice(0, 10))
    .order("term_end", { ascending: false })
    .limit(20);

  // Positions available.
  const { data: positions } = await supabase
    .from("positions")
    .select("id, scope, term_days, election_period_days");

  // Characters in the current city (for candidate list in elections).
  const { data: localChars } = city?.node_id
    ? await supabase
        .from("characters")
        .select("id, name, profession")
        .eq("node_id", city.node_id)
    : { data: [] };

  // My existing votes.
  const { data: myVotes } = await supabase
    .from("votes")
    .select("election_id, candidate_id")
    .eq("voter_id", character.id);

  const myVotesMap = Object.fromEntries(
    (myVotes ?? []).map((v) => [v.election_id, v.candidate_id])
  );

  // Vote tallies for open elections.
  const voteTallies: Record<string, Record<string, number>> = {};
  for (const election of openElections ?? []) {
    const { data: votes } = await supabase
      .from("votes")
      .select("candidate_id")
      .eq("election_id", election.id);
    const tally: Record<string, number> = {};
    for (const v of votes ?? []) {
      tally[v.candidate_id] = (tally[v.candidate_id] ?? 0) + 1;
    }
    voteTallies[election.id] = tally;
  }

  const POSITION_LABEL: Record<string, string> = {
    mayor:    "Mayor",
    governor: "Governor",
  };

  return (
    <div className="space-y-8">
      <header>
        <h1>Senate &amp; Elections</h1>
        <p className="font-serif text-parchment-dark">
          The empire is governed by those bold enough to seek office.
          {city
            ? ` You are in ${city.name}.`
            : " Travel to a city to participate in local elections."}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Open elections */}
        <div className="space-y-5">
          <h2 className="font-display uppercase tracking-imperial text-sm text-gold">
            Open elections
          </h2>

          {!openElections || openElections.length === 0 ? (
            <section className="panel">
              <div className="panel-body">
                <p className="font-serif italic text-parchment-deep">
                  No elections running. Open one below.
                </p>
              </div>
            </section>
          ) : (
            openElections.map((election) => {
              const tally = voteTallies[election.id] ?? {};
              const myVoteFor = myVotesMap[election.id] ?? null;
              const hasVoted = !!myVoteFor;
              const candidates = (localChars ?? []).map((c) => ({
                id: c.id,
                name: c.name,
                profession: c.profession,
              }));
              const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0);

              return (
                <section key={election.id} className="panel">
                  <div className="panel-heading flex items-baseline justify-between">
                    <span>
                      {POSITION_LABEL[election.position_id] ?? election.position_id}
                      <span className="text-parchment-deep text-xs ml-2">
                        scope #{election.scope_id}
                      </span>
                    </span>
                    <span className="font-serif text-xs text-parchment-deep">
                      Closes{" "}
                      {formatDistanceToNow(new Date(election.closes_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  <div className="panel-body space-y-4">
                    {/* Current standing */}
                    {totalVotes > 0 && (
                      <div>
                        <p className="label-imperial mb-1.5">
                          Current standing ({totalVotes} vote
                          {totalVotes !== 1 ? "s" : ""})
                        </p>
                        <ul className="space-y-1">
                          {Object.entries(tally)
                            .sort(([, a], [, b]) => b - a)
                            .map(([charId, count]) => {
                              const c = candidates.find((x) => x.id === charId);
                              return (
                                <li
                                  key={charId}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <span className="font-serif text-parchment">
                                    {c?.name ?? charId.slice(0, 8)}
                                  </span>
                                  <span className="font-display text-gold-bright tabular-nums">
                                    {count}
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    )}

                    {/* Vote form */}
                    {candidates.length === 0 ? (
                      <p className="font-serif italic text-parchment-deep text-sm">
                        No characters here to vote for. Travel to the city.
                      </p>
                    ) : (
                      <VoteForm
                        electionId={election.id}
                        candidates={candidates}
                        hasVoted={hasVoted}
                        myVoteFor={myVoteFor}
                      />
                    )}
                  </div>
                </section>
              );
            })
          )}

          {/* Open a new election */}
          {city && positions && positions.length > 0 && (
            <section className="panel">
              <h3 className="panel-heading">Open an election</h3>
              <div className="panel-body">
                <OpenElectionForm
                  positions={positions}
                  scopeId={city.id}
                />
              </div>
            </section>
          )}
        </div>

        {/* Officeholders */}
        <div className="space-y-5">
          <h2 className="font-display uppercase tracking-imperial text-sm text-gold">
            Current officeholders
          </h2>

          {!officeholders || officeholders.length === 0 ? (
            <section className="panel">
              <div className="panel-body">
                <p className="font-serif italic text-parchment-deep">
                  No officeholders yet. Elections have not been resolved.
                </p>
              </div>
            </section>
          ) : (
            <section className="panel">
              <div className="panel-body">
                <ul className="divide-y divide-gold/10">
                  {officeholders.map((oh) => {
                    const char = Array.isArray(oh.character)
                      ? oh.character[0]
                      : oh.character;
                    return (
                      <li key={oh.id} className="py-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <div>
                            <div className="font-display text-gold-bright">
                              {POSITION_LABEL[oh.position_id] ?? oh.position_id}
                              <span className="text-gold-dim text-xs ml-2">
                                scope #{oh.scope_id}
                              </span>
                            </div>
                            <div className="font-serif text-parchment mt-0.5">
                              {char?.name ?? "Unknown"}
                              <span className="text-parchment-deep text-xs ml-2">
                                {char?.profession}
                              </span>
                            </div>
                          </div>
                          <div className="text-right text-xs text-parchment-deep font-serif">
                            <div>Term ends</div>
                            <div className="text-gold-dim">
                              {format(new Date(oh.term_end), "d MMM yyyy")}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
