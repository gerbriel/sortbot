/**
 * supabaseMock — a minimal, chainable stand-in for the supabase-js client.
 *
 * TEST-ONLY (not imported by any app code). It exists because several service
 * modules import the real client at module scope, so unit-testing their query
 * ORDER and chunking requires a fake that records calls instead of a network.
 *
 * Every recorded call carries its table, operation, filters, payload and whether
 * `.select()` was chained onto a write — which is exactly what the delete-order
 * and 0-rows-affected regressions need to assert.
 */

export type QueryResult = { data: unknown; error: unknown };

export interface MockFilter {
  /** `or` is the one filter with no column of its own — PostgREST takes the
   *  whole `or=(...)` argument as a single string, so it is recorded verbatim
   *  under the column name 'or'. That raw string is exactly what a search test
   *  needs to assert about escaping and column coverage. */
  kind: 'eq' | 'neq' | 'is' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'not' | 'or' | 'ilike';
  column: string;
  value: unknown;
}

export interface MockCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  columns?: string;
  payload?: unknown;
  options?: unknown;
  filters: MockFilter[];
  limit?: number;
  /** the `.range(from, to)` window, when one was requested — lets a test assert
   *  that a paginated fetch actually walks the pages. */
  range?: { from: number; to: number };
  /** true when `.select()` was chained onto a write (so it returns rows) */
  returning: boolean;
}

/** Return a result for this call, or undefined to fall through to the default. */
export type Responder = (call: MockCall) => QueryResult | undefined;

interface Builder extends PromiseLike<QueryResult> {
  select(columns?: string): Builder;
  eq(column: string, value: unknown): Builder;
  neq(column: string, value: unknown): Builder;
  is(column: string, value: unknown): Builder;
  in(column: string, value: unknown[]): Builder;
  gt(column: string, value: unknown): Builder;
  gte(column: string, value: unknown): Builder;
  lt(column: string, value: unknown): Builder;
  lte(column: string, value: unknown): Builder;
  ilike(column: string, value: string): Builder;
  not(column: string, op: string, value: unknown): Builder;
  or(filter: string): Builder;
  order(column: string, options?: unknown): Builder;
  limit(count: number): Builder;
  range(from: number, to: number): Builder;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

export interface MockChannel {
  name: string;
  on(...args: unknown[]): MockChannel;
  subscribe(): MockChannel;
}

export interface SupabaseMockControls {
  calls: MockCall[];
  /** Realtime channel names opened via `channel()`, in order. */
  channels: string[];
  /** How many channels were handed back to `removeChannel()`. */
  removedChannels: number;
  storageRemoveCalls: string[][];
  storageRemoveError: unknown;
  authUser: unknown;
  authSession: unknown;
  getSessionThrows: boolean;
  responder: Responder;
  reset(): void;
  /** Calls whose table + op match, in order. */
  callsFor(table: string, op: MockCall['op']): MockCall[];
  /** The `.in()` value lengths for a table/op — chunking assertions. */
  inSizes(table: string, op: MockCall['op']): number[];
}

export interface MockedSupabaseClient {
  from(table: string): {
    select(columns?: string): Builder;
    insert(payload: unknown): Builder;
    update(payload: unknown): Builder;
    upsert(payload: unknown, options?: unknown): Builder;
    delete(): Builder;
  };
  auth: {
    getUser(): Promise<{ data: { user: unknown }; error: unknown }>;
    getSession(): Promise<{ data: { session: unknown }; error: unknown }>;
    onAuthStateChange(cb: unknown): { data: { subscription: { unsubscribe(): void } } };
  };
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<QueryResult>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
  /** Realtime stub — enough for subscribe/unsubscribe accounting, no events. */
  channel(name: string): MockChannel;
  removeChannel(channel: MockChannel): Promise<'ok'>;
  __mock: SupabaseMockControls;
}

export function createSupabaseMock(): MockedSupabaseClient {
  const controls: SupabaseMockControls = {
    calls: [],
    channels: [],
    removedChannels: 0,
    storageRemoveCalls: [],
    storageRemoveError: null,
    authUser: { id: 'test-user' },
    authSession: { access_token: 'test-token' },
    getSessionThrows: false,
    responder: () => undefined,
    reset() {
      controls.calls = [];
      controls.channels = [];
      controls.removedChannels = 0;
      controls.storageRemoveCalls = [];
      controls.storageRemoveError = null;
      controls.authUser = { id: 'test-user' };
      controls.authSession = { access_token: 'test-token' };
      controls.getSessionThrows = false;
      controls.responder = () => undefined;
    },
    callsFor(table, op) {
      return controls.calls.filter(c => c.table === table && c.op === op);
    },
    inSizes(table, op) {
      return controls
        .callsFor(table, op)
        .flatMap(c => c.filters.filter(f => f.kind === 'in').map(f => (f.value as unknown[]).length));
    },
  };

  const run = (call: MockCall): Promise<QueryResult> =>
    Promise.resolve(controls.responder(call) ?? { data: [], error: null });

  const makeBuilder = (call: MockCall): Builder => {
    const filter = (kind: MockFilter['kind'], column: string, value: unknown): Builder => {
      call.filters.push({ kind, column, value });
      return builder;
    };
    const builder: Builder = {
      select(columns) { call.columns = columns; if (call.op !== 'select') call.returning = true; return builder; },
      eq(c, v) { return filter('eq', c, v); },
      neq(c, v) { return filter('neq', c, v); },
      is(c, v) { return filter('is', c, v); },
      in(c, v) { return filter('in', c, v); },
      gt(c, v) { return filter('gt', c, v); },
      gte(c, v) { return filter('gte', c, v); },
      lt(c, v) { return filter('lt', c, v); },
      lte(c, v) { return filter('lte', c, v); },
      ilike(c, v) { return filter('ilike', c, v); },
      not(c, _op, v) { return filter('not', c, v); },
      or(f) { return filter('or', 'or', f); },
      order() { return builder; },
      limit(count) { call.limit = count; return builder; },
      range(from, to) { call.range = { from, to }; return builder; },
      maybeSingle() { return run(call); },
      single() { return run(call); },
      then(onfulfilled, onrejected) { return run(call).then(onfulfilled, onrejected); },
    };
    return builder;
  };

  const record = (table: string, op: MockCall['op'], payload?: unknown, options?: unknown): Builder => {
    const call: MockCall = { table, op, payload, options, filters: [], returning: false };
    controls.calls.push(call);
    return makeBuilder(call);
  };

  return {
    from(table) {
      return {
        select: (columns?: string) => {
          const b = record(table, 'select');
          return b.select(columns);
        },
        insert: (payload: unknown) => record(table, 'insert', payload),
        update: (payload: unknown) => record(table, 'update', payload),
        upsert: (payload: unknown, options?: unknown) => record(table, 'upsert', payload, options),
        delete: () => record(table, 'delete'),
      };
    },
    auth: {
      async getUser() { return { data: { user: controls.authUser }, error: null }; },
      async getSession() {
        if (controls.getSessionThrows) throw new Error('network');
        return { data: { session: controls.authSession }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() { /* no-op */ } } } };
      },
    },
    channel(name: string): MockChannel {
      controls.channels.push(name);
      const ch: MockChannel = {
        name,
        on() { return ch; },
        subscribe() { return ch; },
      };
      return ch;
    },
    async removeChannel() {
      controls.removedChannels += 1;
      return 'ok' as const;
    },
    storage: {
      from() {
        return {
          async remove(paths: string[]) {
            controls.storageRemoveCalls.push(paths);
            return { data: null, error: controls.storageRemoveError };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.test/${path}` } };
          },
        };
      },
    },
    __mock: controls,
  };
}
