import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrackSelectionGate } from '../track-selection-gate.mjs';
import { PlaybackSession } from '../playbackSession.mjs';

const song = ref => ({ source: 'netease', id: ref, ref });

test('solo playback is unrestricted and the first paired choice starts a lock', () => {
    let time = 1000;
    const gate = new TrackSelectionGate(() => time);
    assert.equal(gate.allow(song('a')), true);
    assert.equal(gate.allow(song('b')), true);
    gate.setPaired(true);
    assert.equal(gate.allow(song('a')), true);
    assert.equal(gate.allow(song('b')), false);
    time += 2500;
    assert.equal(gate.allow(song('b')), true);
});

test('preparing and awaiting-end block user choices but admit one internal selection', () => {
    const gate = new TrackSelectionGate(() => 1000);
    gate.setPaired(true);
    gate.observe({ transition: { id: 't1', phase: 'preparing' } });
    assert.equal(gate.allow(song('other')), false);
    const clear = gate.permit('target');
    assert.equal(gate.allow(song('target')), true);
    assert.equal(gate.allow(song('target')), false, 'internal permit is consumed once');
    clear();
    gate.observe({ transition: { id: 't1', phase: 'awaiting-end' } });
    assert.equal(gate.allow(song('other')), false);
});

test('GO keeps a brief lock and disconnect clears it', () => {
    let time = 1000;
    const gate = new TrackSelectionGate(() => time);
    gate.setPaired(true);
    gate.observe({ transition: { id: 't1', phase: 'preparing' } });
    gate.observe({ transition: { id: 't1', phase: 'go' } });
    time += 1500;
    assert.equal(gate.allow(song('next')), false);
    time += 600;
    assert.equal(gate.allow(song('next')), true);
    gate.setPaired(false);
    assert.equal(gate.allow(song('another')), true);
});

test('the playback hook blocks a second user choice but admits the authority switch', async () => {
    const target = song('target');
    let current = null;
    let notices = 0;
    let session;
    const folium = {
        playback: {
            getQueue: () => ({ items: [{ index: 0, song: target }] }),
            getState: () => ({ song: current, state: 'paused', position: 0 }),
            playQueueItem: async () => {
                const event = { song: target, cancelled: false, cancel() { this.cancelled = true; } };
                session.beforePlay(event);
                if (event.cancelled) return false;
                current = target;
                return true;
            },
            pause() {},
        },
        omni: {}, ui: { toast() { notices++; } }, log: { warn() {} },
    };
    session = new PlaybackSession(folium, async () => {}, () => {});
    session.gate.setPaired(true);
    session.gate.observe({ transition: { id: 't1', phase: 'preparing' } });
    const userEvent = { song: song('other'), cancelled: false, cancel() { this.cancelled = true; } };
    session.beforePlay(userEvent);
    assert.equal(userEvent.cancelled, true);
    assert.equal(notices, 1);
    assert.equal(await session.adapter.switchTrack({ currentIndex: 0, currentTrackId: 'netease:target' }), true);
    assert.equal(current, target);
    session.dispose();
});

test('paired room waiting for its first song pauses a transport resume and prompts for a song', async () => {
    let state = 'playing';
    let pauses = 0;
    const notices = [];
    const folium = {
        playback: {
            getState: () => ({ song: { source: 'netease', id: 'old' }, state, position: 0 }),
            pause: () => { pauses++; state = 'paused'; },
        },
        omni: {}, ui: { toast: message => notices.push(message) }, log: { warn() {} },
    };
    const session = new PlaybackSession(folium, async () => {}, () => {});
    session.core.setConnection(true, 'local');
    session.room = { members: [{ senderId: 'local' }, { senderId: 'peer' }], currentTrackId: '', queue: [] };
    await session.state('playing');
    assert.equal(pauses, 1);
    assert.deepEqual(notices, ['请点播第一首你想听的歌']);
    state = 'playing';
    await session.state('playing');
    assert.equal(pauses, 2);
    assert.equal(notices.length, 1, 'rapid repeat presses share one notice');
    session.disconnect();
    session.core.setConnection(true, 'local');
    state = 'playing';
    await session.state('playing');
    assert.equal(notices.length, 2, 'a new room may show the notice again');
    session.dispose();
});

test('waiting-first-song guard stays out of solo playback and does not prompt during a song selection', async () => {
    let state = 'playing';
    let pauses = 0;
    const notices = [];
    const folium = {
        playback: {
            getState: () => ({ song: { source: 'netease', id: 'new' }, state, position: 0 }),
            pause: () => { pauses++; state = 'paused'; },
        },
        omni: {}, ui: { toast: message => notices.push(message) }, log: { warn() {} },
    };
    const session = new PlaybackSession(folium, async () => {}, () => {});
    session.room = { members: [{ senderId: 'local' }], currentTrackId: '', queue: [] };
    await session.state('playing');
    assert.equal(pauses, 0, 'solo playback remains unrestricted');
    session.core.setConnection(true, 'local');
    session.room.members.push({ senderId: 'peer' });
    session.pendingTrack = 'netease:new';
    await session.state('playing');
    assert.equal(pauses, 1, 'selected first song remains paused until GO');
    assert.deepEqual(notices, [], 'a selected song is not mistaken for a transport resume');
    session.pendingTrack = '';
    session.room.currentTrackId = 'netease:new';
    state = 'playing';
    await session.state('playing');
    assert.equal(pauses, 1, 'normal playback after the first choice is not blocked');
    session.dispose();
});

test('GO keeps the switching notice and lock until local playback is applied', () => {
    const folium = { playback: {}, omni: {}, ui: { toast() {} }, log: { warn() {} } };
    const session = new PlaybackSession(folium, async () => {}, () => {});
    session.core.setConnection(true, 'local');
    session.gate.setPaired(true);
    session.room = { currentTrackId: 'netease:target', playing: true,
        transition: { id: 't1', phase: 'go' } };
    session.gate.observe(session.room);
    session.core.machine.transition({ trackId: 'netease:target', status: 'buffering', version: 1 });
    assert.equal(session.isSwitching(), true);
    session.core.machine.transition({ status: 'playing', version: 1 });
    assert.equal(session.isSwitching(), false);
    session.dispose();
});
