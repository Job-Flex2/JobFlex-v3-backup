# The fence film's own database: a copy of prisma/dev.db with QA Co (qa@acme.test's org) dressed
# as a fence contractor, plus the homeowner the proposal goes to.
#   DST=.cache/fence-rec/rec.db python advertisement/fence/stand/make-db.py   (overwritten)
import sqlite3, time, os
SRC = 'prisma/dev.db'; DST = os.environ.get('DST', '.cache/fence-rec/rec.db')
os.makedirs(os.path.dirname(DST), exist_ok=True)
if os.path.exists(DST): os.remove(DST)
s = sqlite3.connect(SRC); d = sqlite3.connect(DST); s.backup(d); s.close()
oid = d.execute("select activeOrgId from User where email='qa@acme.test'").fetchone()[0]
now = int(time.time() * 1000)
# a paid plan (manual), so neither the free plan's proposal cap nor a page gate gets in the way
d.execute("delete from Subscription where organizationId=?", (oid,))
d.execute("insert into Subscription (id, organizationId, plan, status, provider, createdAt, updatedAt) values ('fencerec_sub', ?, 'ENTERPRISE', 'ACTIVE', 'MANUAL', ?, ?)", (oid, now, now))
d.execute("update Organization set name='Cedar & Post Fence Co.', phone='(425) 555-0162', address='8215 160th Ave NE, Redmond, WA 98052', isInternal=0 where id=?", (oid,))
d.execute("delete from SyncState where key like 'rl:%'")
# the shop's test leads stand down, the owner gets a person's name
d.execute("update Lead set status='LOST' where organizationId=? and status in ('NEW','CLAIMED','CONTACTED')", (oid,))
d.execute("update User set name='Jordan Hale' where email='qa@acme.test'")
# the price book starts from the catalog's own rates (the QA runs left a test override and a custom type)
d.execute("delete from FenceCatalog where organizationId=?", (oid,))
# a homeowner at the filmed house; 555 is the fictional exchange, example.com the reserved domain
d.execute("delete from Client where id='fencerec_client'")
d.execute("insert into Client (id, organizationId, name, email, phone, address, city, state, zip, createdAt, updatedAt) values ('fencerec_client', ?, 'Megan Ortiz', 'megan.ortiz@example.com', '(425) 555-0177', ?, ?, 'WA', ?, ?, ?)",
          (oid, os.environ.get('C_ADDR', '17028 NE 100th St'), os.environ.get('C_CITY', 'Redmond'), os.environ.get('C_ZIP', '98052'), now, now))
d.commit()
print('org', oid, d.execute("select name, slug from Organization where id=?", (oid,)).fetchone())
