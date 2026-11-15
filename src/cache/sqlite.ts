/**
 * SQLite 缓存（Node 22 内置 node:sqlite）
 *
 * 只存结构化字段；不落 HTML/Cookie/验证码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { QueryRecord } from '../domain/query.js';
import type { SupplierDetail, SupplierSummary } from '../domain/supplier.js';
import type { FactoryItem } from '../domain/factories.js';
import type { CacheStats } from '../domain/cache.js';
import { AliError } from '../errors/catalog.js';
import type { CacheStore, CachedValue, FactoryPageRecord, PageRecord } from './types.js';
import { cachedValue } from './types.js';

const require = createRequire(import.meta.url);

interface Stmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (file: string) => Db;
}

function loadSqlite(): SqliteModule {
  try {
    return require('node:sqlite') as SqliteModule;
  } catch (err) {
    throw new AliError('CACHE_ERROR', 'node:sqlite 不可用（需要 Node >= 22.5）', { cause: err });
  }
}

const SCHEMA_VERSION = '1';

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS queries (
  query_id TEXT PRIMARY KEY,
  spec_json TEXT NOT NULL,
  keyword TEXT,
  province TEXT,
  city TEXT,
  location_mode TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'CN',
  pages_requested INTEGER NOT NULL,
  pages_fetched_json TEXT NOT NULL,
  total_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queries_expires ON queries(expires_at);
CREATE TABLE IF NOT EXISTS query_items (
  query_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  position INTEGER NOT NULL,
  company_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  is_ad INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (query_id, page, position)
);
CREATE INDEX IF NOT EXISTS idx_query_items_company ON query_items(company_id);
CREATE TABLE IF NOT EXISTS suppliers (
  company_id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  store_url TEXT,
  logo_url TEXT,
  country TEXT,
  province TEXT,
  city TEXT,
  location_confidence TEXT,
  joined_years INTEGER,
  supplier_stars INTEGER,
  plan TEXT,
  summary_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_loc ON suppliers(province, city);
CREATE INDEX IF NOT EXISTS idx_suppliers_plan ON suppliers(plan);
CREATE TABLE IF NOT EXISTS supplier_details (
  company_id TEXT PRIMARY KEY,
  detail_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'render.htm',
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_details_expires ON supplier_details(expires_at);
CREATE TABLE IF NOT EXISTS factories (
  category_id TEXT NOT NULL DEFAULT '0',
  page INTEGER NOT NULL,
  position INTEGER NOT NULL,
  company_id TEXT NOT NULL,
  factory_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (category_id, page, position)
);
`;

const iso = (ms: number): string => new Date(ms).toISOString();
const nowIso = (): string => new Date().toISOString();

export class SqliteCacheStore implements CacheStore {
  readonly driver = 'sqlite' as const;
  private db: Db | null = null;

  constructor(private readonly dbPath: string) {}

  private get conn(): Db {
    if (!this.db) throw new AliError('CACHE_ERROR', 'sqlite cache not initialized');
    return this.db;
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
    this.db.exec(DDL);
    const row = this.conn.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value?: string } | undefined;
    if (!row) {
      this.conn.prepare('INSERT OR REPLACE INTO meta(key, value, updated_at) VALUES(?, ?, ?)').run('schema_version', SCHEMA_VERSION, nowIso());
    } else if (row.value !== SCHEMA_VERSION) {
      this.conn.prepare('INSERT OR REPLACE INTO meta(key, value, updated_at) VALUES(?, ?, ?)').run('schema_version', SCHEMA_VERSION, nowIso());
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  getQuery(queryId: string): QueryRecord | null {
    const row = this.conn.prepare('SELECT * FROM queries WHERE query_id = ?').get(queryId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      queryId: String(row.query_id),
      specJson: String(row.spec_json),
      keyword: row.keyword === null ? null : String(row.keyword),
      province: row.province === null ? null : String(row.province),
      city: row.city === null ? null : String(row.city),
      locationMode: String(row.location_mode) as QueryRecord['locationMode'],
      filtersJson: String(row.filters_json),
      country: String(row.country),
      pagesRequested: Number(row.pages_requested),
      pagesFetched: JSON.parse(String(row.pages_fetched_json)) as number[],
      totalCount: row.total_count === null ? null : Number(row.total_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      expiresAt: String(row.expires_at),
    };
  }

  putQuery(record: QueryRecord): void {
    this.conn
      .prepare(
        `INSERT OR REPLACE INTO queries
         (query_id, spec_json, keyword, province, city, location_mode, filters_json, country,
          pages_requested, pages_fetched_json, total_count, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.queryId,
        record.specJson,
        record.keyword,
        record.province,
        record.city,
        record.locationMode,
        record.filtersJson,
        record.country,
        record.pagesRequested,
        JSON.stringify(record.pagesFetched),
        record.totalCount,
        record.createdAt,
        record.updatedAt,
        record.expiresAt,
      );
  }

  updateQueryProgress(queryId: string, patch: Partial<Pick<QueryRecord, 'pagesFetched' | 'totalCount' | 'updatedAt'>>): void {
    const cur = this.getQuery(queryId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.conn
      .prepare('UPDATE queries SET pages_fetched_json = ?, total_count = ?, updated_at = ? WHERE query_id = ?')
      .run(JSON.stringify(next.pagesFetched), next.totalCount, next.updatedAt, queryId);
  }

  getPage(queryId: string, page: number, ttlSec: number): CachedValue<PageRecord> | null {
    const rows = this.conn
      .prepare('SELECT summary_json, is_ad, fetched_at, expires_at FROM query_items WHERE query_id = ? AND page = ? ORDER BY position ASC')
      .all(queryId, page) as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    const fetchedAt = Date.parse(String(rows[0].fetched_at));
    const expiresAt = Date.parse(String(rows[0].expires_at));
    const items = rows.map((r) => JSON.parse(String(r.summary_json)) as SupplierSummary);
    const rec: PageRecord = {
      queryId,
      page,
      totalCount: null,
      items,
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
    };
    const value = cachedValue(rec, rec.fetchedAt, 0);
    value.expiresAt = Number.isFinite(expiresAt) ? expiresAt : value.expiresAt;
    value.fresh = Date.now() < value.expiresAt;
    void ttlSec;
    return value;
  }

  putPage(record: PageRecord): void {
    const expiresAt = iso(Date.now() + 7200 * 1000);
    this.conn.prepare('DELETE FROM query_items WHERE query_id = ? AND page = ?').run(record.queryId, record.page);
    const stmt = this.conn.prepare(
      `INSERT INTO query_items(query_id, page, position, company_id, summary_json, is_ad, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    record.items.forEach((item, i) => {
      stmt.run(
        record.queryId,
        record.page,
        i,
        item.companyId,
        JSON.stringify(item),
        item.isAd ? 1 : 0,
        iso(record.fetchedAt),
        expiresAt,
      );
    });
  }

  getPages(queryId: string): number[] {
    const rows = this.conn.prepare('SELECT DISTINCT page FROM query_items WHERE query_id = ? ORDER BY page ASC').all(queryId) as Array<{ page: number }>;
    return rows.map((r) => Number(r.page));
  }

  getSupplierItems(queryId: string): SupplierSummary[] {
    const rows = this.conn
      .prepare('SELECT summary_json FROM query_items WHERE query_id = ? ORDER BY page ASC, position ASC')
      .all(queryId) as Array<{ summary_json: string }>;
    return rows.map((r) => JSON.parse(String(r.summary_json)) as SupplierSummary);
  }

  getSupplier(companyId: string): SupplierSummary | null {
    const row = this.conn.prepare('SELECT summary_json FROM suppliers WHERE company_id = ?').get(companyId) as { summary_json?: string } | undefined;
    return row ? (JSON.parse(String(row.summary_json)) as SupplierSummary) : null;
  }

  putSupplier(summary: SupplierSummary): void {
    this.conn
      .prepare(
        `INSERT OR REPLACE INTO suppliers
         (company_id, company_name, store_url, logo_url, country, province, city, location_confidence,
          joined_years, supplier_stars, plan, summary_json, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT first_seen_at FROM suppliers WHERE company_id = ?), ?), ?)`,
      )
      .run(
        summary.companyId,
        summary.companyName,
        summary.storeUrl,
        summary.logoUrl,
        summary.country,
        summary.location.province,
        summary.location.city,
        summary.location.confidence,
        summary.joinedYears,
        summary.supplierIndex?.stars ?? null,
        summary.membership.plan,
        JSON.stringify(summary),
        summary.companyId,
        nowIso(),
        nowIso(),
      );
  }

  getDetail(companyId: string, ttlSec: number): CachedValue<SupplierDetail> | null {
    const row = this.conn.prepare('SELECT detail_json, fetched_at, expires_at FROM supplier_details WHERE company_id = ?').get(companyId) as
      | { detail_json?: string; fetched_at?: string; expires_at?: string }
      | undefined;
    if (!row) return null;
    const detail = JSON.parse(String(row.detail_json)) as SupplierDetail;
    const fetchedAt = Date.parse(String(row.fetched_at));
    const expiresAt = Date.parse(String(row.expires_at));
    const value = cachedValue(detail, Number.isFinite(fetchedAt) ? fetchedAt : Date.now(), 0);
    value.expiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + ttlSec * 1000;
    value.fresh = Date.now() < value.expiresAt;
    return value;
  }

  putDetail(detail: SupplierDetail): void {
    const now = Date.now();
    this.conn
      .prepare('INSERT OR REPLACE INTO supplier_details(company_id, detail_json, source, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(detail.companyId, JSON.stringify(detail), 'render.htm', iso(now), iso(now + 7 * 86400 * 1000));
  }

  listDetailIds(): string[] {
    const rows = this.conn.prepare('SELECT company_id FROM supplier_details').all() as Array<{ company_id: string }>;
    return rows.map((r) => String(r.company_id));
  }

  getFactoryPage(categoryId: string, page: number, ttlSec: number): CachedValue<FactoryPageRecord> | null {
    const rows = this.conn
      .prepare('SELECT factory_json, fetched_at, expires_at FROM factories WHERE category_id = ? AND page = ? ORDER BY position ASC')
      .all(categoryId, page) as Array<{ factory_json: string; fetched_at: string; expires_at: string }>;
    if (rows.length === 0) return null;
    const fetchedAt = Date.parse(rows[0].fetched_at);
    const expiresAt = Date.parse(rows[0].expires_at);
    const value = cachedValue<FactoryPageRecord>(
      {
        categoryId,
        page,
        items: rows.map((r) => JSON.parse(String(r.factory_json)) as FactoryItem),
        upstreamTotal: null,
        fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
      },
      Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
      0,
    );
    value.expiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + ttlSec * 1000;
    value.fresh = Date.now() < value.expiresAt;
    return value;
  }

  putFactoryPage(record: FactoryPageRecord): void {
    const expiresAt = iso(Date.now() + 86400 * 1000);
    this.conn.prepare('DELETE FROM factories WHERE category_id = ? AND page = ?').run(record.categoryId, record.page);
    const stmt = this.conn.prepare(
      'INSERT INTO factories(category_id, page, position, company_id, factory_json, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    record.items.forEach((item, i) => {
      stmt.run(record.categoryId, record.page, i, item.companyId, JSON.stringify(item), iso(record.fetchedAt), expiresAt);
    });
  }

  getMeta(key: string): string | null {
    const row = this.conn.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: string } | undefined;
    return row ? String(row.value) : null;
  }

  putMeta(key: string, value: string): void {
    this.conn.prepare('INSERT OR REPLACE INTO meta(key, value, updated_at) VALUES (?, ?, ?)').run(key, value, nowIso());
  }

  private count(table: string): number {
    const row = this.conn.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number } | undefined;
    return row?.c ? Number(row.c) : 0;
  }

  async stats(): Promise<CacheStats> {
    const queries = this.count('queries');
    const suppliers = this.count('suppliers');
    const details = this.count('supplier_details');
    const factories = this.count('factories');
    const expiredRow = this.conn
      .prepare("SELECT COUNT(*) AS c FROM supplier_details WHERE expires_at < ?")
      .get(nowIso()) as { c?: number } | undefined;
    const oldestRow = this.conn.prepare('SELECT MIN(created_at) AS t FROM queries').get() as { t?: string } | undefined;
    let bytes = 0;
    try {
      bytes = fs.statSync(this.dbPath).size;
    } catch {
      bytes = 0;
    }
    return {
      driver: 'sqlite',
      queries: { count: queries, oldestAt: oldestRow?.t ?? null },
      suppliers: { count: suppliers },
      details: { count: details, expired: expiredRow?.c ? Number(expiredRow.c) : 0 },
      factories: { count: factories },
      bytes,
    };
  }

  async clear(opts: { kind: 'all' | 'queries' | 'suppliers' | 'details' | 'factories' }): Promise<{
    queries: number;
    suppliers: number;
    details: number;
    factories: number;
  }> {
    const deleted = {
      queries: opts.kind === 'all' || opts.kind === 'queries' ? this.count('queries') : 0,
      suppliers: opts.kind === 'all' || opts.kind === 'suppliers' ? this.count('suppliers') : 0,
      details: opts.kind === 'all' || opts.kind === 'details' ? this.count('supplier_details') : 0,
      factories: opts.kind === 'all' || opts.kind === 'factories' ? this.count('factories') : 0,
    };
    if (opts.kind === 'all' || opts.kind === 'queries') {
      this.conn.exec('DELETE FROM query_items; DELETE FROM queries;');
    }
    if (opts.kind === 'all' || opts.kind === 'suppliers') this.conn.exec('DELETE FROM suppliers;');
    if (opts.kind === 'all' || opts.kind === 'details') this.conn.exec('DELETE FROM supplier_details;');
    if (opts.kind === 'all' || opts.kind === 'factories') this.conn.exec('DELETE FROM factories;');
    return deleted;
  }
}
