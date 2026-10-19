# The film's own database: a copy of prisma/dev.db with QA Co (qa@acme.test's org) dressed as an HVAC shop.
#   python advertisement/hvac/stand/make-db.py   -> .cache/hvac-ad/hvac-ad.db (overwritten)
import sqlite3, time, os
SRC = 'prisma/dev.db'; DST = os.environ.get('DST', '.cache/hvac-ad/hvac-ad.db')
os.makedirs(os.path.dirname(DST), exist_ok=True)
if os.path.exists(DST): os.remove(DST)
s = sqlite3.connect(SRC); d = sqlite3.connect(DST); s.backup(d); s.close()
oid = d.execute("select activeOrgId from User where email='qa@acme.test'").fetchone()[0]
now = int(time.time() * 1000)
d.execute("delete from Subscription where organizationId=?", (oid,))
d.execute("insert into Subscription (id, organizationId, plan, status, provider, createdAt, updatedAt) values ('hvacad_sub', ?, 'ENTERPRISE', 'ACTIVE', 'MANUAL', ?, ?)", (oid, now, now))
d.execute("update Organization set name='Ridgeline Heating & Air', phone='(425) 555-0148', address='12618 NE 100th St, Kirkland, WA 98033', isInternal=0 where id=?", (oid,))
d.execute("delete from SyncState where key like 'rl:%'")
d.commit()
print('org', oid, d.execute("select name, slug from Organization where id=?", (oid,)).fetchone())
# the shop's test leads stand down (they would list under the stepper), the owner gets a person's name
d.execute("update Lead set status='LOST' where organizationId=? and status in ('NEW','CLAIMED','CONTACTED')", (oid,))
d.execute("update User set name='Alex Morgan' where email='qa@acme.test'")
d.commit()
# the catalog is the shop's real-brand list: the placeholder "Starter" ladder rows go
d.execute("delete from HvacCatalogItem where organizationId=? and brand='Starter'", (oid,))
d.commit()
