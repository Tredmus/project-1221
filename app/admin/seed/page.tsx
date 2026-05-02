import SeedForm from "./SeedForm";

export const metadata = {
  title: "Seed world · Imperium",
};

const SAMPLE_PAYLOAD = {
  nodes: [
    {
      key: "constantinople",
      name: "Constantinople",
      type: "city",
      province_id: 1,
      is_capital: true,
      map_x: 660,
      map_y: 420,
    },
    {
      key: "adrianople",
      name: "Adrianople",
      type: "city",
      province_id: 1,
      map_x: 580,
      map_y: 380,
    },
    {
      key: "thessaloniki",
      name: "Thessaloniki",
      type: "city",
      province_id: 3,
      map_x: 460,
      map_y: 440,
    },
  ],
  connections: [
    { from: "constantinople", to: "adrianople", travel_cost: 3, road_type: "road" },
    { from: "adrianople", to: "thessaloniki", travel_cost: 5, road_type: "road" },
  ],
  cities: [
    {
      node_key: "constantinople",
      name: "Constantinople",
      wall_level: 5,
      is_capital: true,
      properties: {
        description: "The Queen of Cities",
        port: true,
        market_level: 3,
      },
    },
    {
      node_key: "adrianople",
      name: "Adrianople",
      wall_level: 3,
      properties: {
        description: "Gateway to Thrace",
        port: false,
        market_level: 2,
      },
    },
    {
      node_key: "thessaloniki",
      name: "Thessaloniki",
      wall_level: 3,
      properties: {
        description: "Second city of the Empire",
        port: true,
        market_level: 2,
      },
    },
  ],
};

export default function SeedPage() {
  return (
    <div className="space-y-8">
      <section className="panel">
        <h2 className="panel-heading">Seed world (JSON)</h2>
        <div className="panel-body space-y-4">
          <p className="font-serif text-parchment-dark">
            Paste a JSON payload describing nodes, connections, and cities.
            Nodes are inserted first; connections and cities reference them
            by the <code className="text-gold-bright">key</code> string you
            assign in the payload.
          </p>
          <p className="font-serif text-parchment-dark">
            Existing rows are not deleted — this is an additive seed. Re-running
            with the same keys will create duplicate nodes (we don&rsquo;t
            attempt to deduplicate during MVP). Use the SQL editor to clean up
            mistakes.
          </p>

          <details className="rounded-sm border border-gold/15 bg-imperial-shadow/40 p-3">
            <summary className="cursor-pointer font-display uppercase tracking-imperial text-xs text-gold">
              Show example payload
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto text-xs text-parchment-dark">
              {JSON.stringify(SAMPLE_PAYLOAD, null, 2)}
            </pre>
          </details>

          <SeedForm sample={JSON.stringify(SAMPLE_PAYLOAD, null, 2)} />
        </div>
      </section>
    </div>
  );
}
