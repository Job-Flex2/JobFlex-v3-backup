# The demo recording's extra dressing on top of make-db.py: the homeowner the
# proposal goes to (a client record at the filmed house).
#   DST=.cache/hvac-rec/rec.db python advertisement/hvac/stand/make-db.py
#   DST=.cache/hvac-rec/rec.db python advertisement/hvac/stand/rec-dress.py   -> prints the client id
import sqlite3, time, os
DST = os.environ.get('DST', '.cache/hvac-rec/rec.db')
d = sqlite3.connect(DST)
oid = d.execute("select activeOrgId from User where email='qa@acme.test'").fetchone()[0]
now = int(time.time() * 1000)
d.execute("delete from Client where id='hvacrec_client'")
# a homeowner at the filmed house; 555 is the fictional exchange, example.com the reserved domain
d.execute("insert into Client (id, organizationId, name, email, phone, address, city, state, zip, createdAt, updatedAt) values ('hvacrec_client', ?, 'Jenna Brooks', 'jenna.brooks@example.com', '(425) 555-0193', '12629 NE 100th Pl', 'Kirkland', 'WA', '98033', ?, ?)", (oid, now, now))
d.commit()
print('hvacrec_client')
