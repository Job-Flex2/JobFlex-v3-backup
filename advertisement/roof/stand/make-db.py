# The roof demo's own database: a copy of prisma/dev.db with QA Co (qa@acme.test's org) dressed as a
# roofing contractor, a homeowner at the filmed house, and the house's aerial answer in its ledger.
#   DST=.cache/roof-rec/rec.db python advertisement/roof/stand/make-db.py   (overwritten every take)
import sqlite3, time, os, json
SRC = 'prisma/dev.db'; DST = os.environ.get('DST', '.cache/roof-rec/rec.db')
os.makedirs(os.path.dirname(DST), exist_ok=True)
if os.path.exists(DST): os.remove(DST)
s = sqlite3.connect(SRC); d = sqlite3.connect(DST); s.backup(d); s.close()
oid = d.execute("select activeOrgId from User where email='qa@acme.test'").fetchone()[0]
now = int(time.time() * 1000)
d.execute("delete from Subscription where organizationId=?", (oid,))
d.execute("insert into Subscription (id, organizationId, plan, status, provider, createdAt, updatedAt) values ('roofrec_sub', ?, 'ENTERPRISE', 'ACTIVE', 'MANUAL', ?, ?)", (oid, now, now))
# a made-up shop; the town only (no street of anyone's), so the brands rank for Washington
d.execute("update Organization set name='Alder Peak Roofing', phone='(425) 555-0136', address='Kirkland, WA 98033', isInternal=0 where id=?", (oid,))
d.execute("delete from SyncState where key like 'rl:%'")
d.execute("update Lead set status='LOST' where organizationId=? and status in ('NEW','CLAIMED','CONTACTED')", (oid,))
d.execute("update User set name='Dana Fischer' where email='qa@acme.test'")
# the shop's earlier roof rows would list under "Recent measurements"
d.execute("delete from RoofMeasurement where organizationId=?", (oid,))
# the agents' test entries in the shop's roof book (script-injection probes, "QA solar tile") go: the shop prices from the
# built-in book until it saves its own
d.execute("delete from RoofCatalog where organizationId=?", (oid,))
d.commit()
# the homeowner at the filmed house; 555 is the fictional exchange, example.com the reserved domain
d.execute("delete from Client where id='roofrec_client'")
d.execute("insert into Client (id, organizationId, name, email, phone, address, city, state, zip, createdAt, updatedAt) values ('roofrec_client', ?, 'Mark Ellison', 'mark.ellison@example.com', '(425) 555-0172', '9903 117th Pl NE', 'Kirkland', 'WA', '98033', ?, ?)", (oid, now, now))
# The house's EagleView Property Data answer: the account bought it on 2026-08-27 (request aa5f7a47, all seven
# packs) under another of its organisations. A copy of that ledger row (its request id prefixed: the column is
# unique) goes in the shop's ledger, so the estimator's own reuse path answers the click from it — no new order
# is placed (a new one is billed).
row = d.execute("select addressKey, address, requestId, status, instantJson, error, createdAt, updatedAt, instantRawJson, packs from InstantOrder where addressKey='9903 117TH PL NE|KIRKLAND|WA|98033' and status='complete'").fetchone()
if not row: raise SystemExit('the ledger row for 9903 117th Pl NE is missing from dev.db')
d.execute("delete from InstantOrder where id='roofrec_ev'")
d.execute("insert into InstantOrder (id, organizationId, addressKey, address, requestId, status, instantJson, error, createdAt, updatedAt, instantRawJson, packs) values ('roofrec_ev', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          (oid, row[0], row[1], 'roofrec-' + row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]))
d.commit()
print('org', oid, d.execute("select name from Organization where id=?", (oid,)).fetchone()[0], '· client roofrec_client · ledger row roofrec_ev')
