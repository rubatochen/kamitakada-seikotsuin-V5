"""Local SQLite smoke test: no network, no production D1 changes."""
from pathlib import Path
import re
import sqlite3

root = Path(__file__).resolve().parents[1]
code = (root / 'functions/lib/reservation-events.js').read_text()
insert = re.search(r'export const NON_OVERLAP_INSERT_SQL = `(.*?)`;', code, re.S).group(1)
update = re.search(r'export const NON_OVERLAP_UPDATE_SQL = `(.*?)`;', code, re.S).group(1)
conn = sqlite3.connect(':memory:')
conn.executescript((root / 'schema.sql').read_text())

def insert_appt(identifier, time, duration):
    start = int(time[:2]) * 60 + int(time[3:])
    return conn.execute(insert, (
        identifier, '2026-11-02', time, 'TEST', '09012345678', None, '',
        'confirmed', '2026-10-20', duration,
        '2026-11-02', start + duration, start,
    )).rowcount

assert insert_appt('a','14:00',30) == 1
assert insert_appt('b','14:01',30) == 0
assert insert_appt('c','14:29',30) == 0
assert insert_appt('d','14:30',30) == 1
assert insert_appt('e','15:00',60) == 1
assert insert_appt('f','16:00',30) == 1
assert conn.execute(update, (
    '2026-11-02','14:15','TEST','09012345678','',30,'a',
    '2026-11-02','a',14*60+45,14*60+15,
)).rowcount == 0
assert conn.execute(update, (
    '2026-11-02','14:00','TEST','09012345678','',30,'a',
    '2026-11-02','a',14*60+30,14*60,
)).rowcount == 1
print('PASS: adjacent slots work, overlapping insert/update blocked')
