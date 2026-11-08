"""Local SQLite smoke test for the lane-aware overlap SQL: no network, no production D1 changes."""
from pathlib import Path
import re
import sqlite3

root = Path(__file__).resolve().parents[1]
code = (root / 'functions/lib/reservation-events.js').read_text()
insert = re.search(r'export const NON_OVERLAP_INSERT_SQL = `(.*?)`;', code, re.S).group(1)
update = re.search(r'export const NON_OVERLAP_UPDATE_SQL = `(.*?)`;', code, re.S).group(1)
conn = sqlite3.connect(':memory:')
conn.executescript((root / 'schema.sql').read_text())
D = '2026-11-02'

def insert_appt(identifier, time, duration, lane='L1'):
    start = int(time[:2]) * 60 + int(time[3:])
    try:
        return conn.execute(insert, (
            identifier, D, time, 'TEST', '09012345678', None, '',
            'confirmed', '2026-10-20', duration, 'seikotsu', lane,
            D, lane, start + duration, start,
        )).rowcount
    except sqlite3.IntegrityError:
        return 0

def update_appt(identifier, time, duration, lane='L1'):
    start = int(time[:2]) * 60 + int(time[3:])
    return conn.execute(update, (
        D, time, 'TEST', '09012345678', '', duration, 'seikotsu', lane,
        identifier,
        D, identifier, lane, start + duration, start,
    )).rowcount

assert insert_appt('a', '14:00', 30) == 1
assert insert_appt('b', '14:01', 30) == 0          # overlaps a, same lane
assert insert_appt('c', '14:29', 30) == 0
assert insert_appt('d', '14:30', 30) == 1          # adjacent is fine
assert insert_appt('e', '15:00', 60) == 1
assert insert_appt('f', '16:00', 30) == 1
assert insert_appt('g', '14:00', 30, 'L2') == 1    # same time, other lane
assert insert_appt('h', '14:00', 30, 'L2') == 0    # L2 now taken too
assert update_appt('a', '14:15', 30) == 0          # would overlap d on L1
assert update_appt('a', '14:00', 30) == 1
assert update_appt('d', '14:10', 30, 'L2') == 0    # would overlap g on L2
print('PASS: adjacent slots work, overlap blocked within a lane, allowed across lanes')
