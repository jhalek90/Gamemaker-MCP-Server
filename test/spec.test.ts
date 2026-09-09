import { describe, expect, it } from 'vitest';
import { compareVersions, findRuntimes, GmlSpec, parseXml, signatureOf, summarize } from '../src/spec/index.js';

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<GameMakerLanguageSpec RuntimeVersion="2022.4" Module="Base">
  <!-- a comment -->
  <Functions>
    <Function Name="buffer_write" Deprecated="false" ReturnType="Real" Pure="false">
      <Description>Writes &amp; data &lt;to&gt; a buffer.</Description>
      <Parameter Name="buffer" Type="Id.Buffer" Optional="false">The buffer.</Parameter>
      <Parameter Name="type" Type="Constant.BufferDataType" Optional="false">Data type.</Parameter>
      <Parameter Name="value" Type="Any" Optional="true">The value.</Parameter>
    </Function>
    <Function Name="no_body" Deprecated="true" ReturnType="Undefined" Pure="true"/>
    <Function Name="room_goto" Deprecated="false" ReturnType="Undefined" Pure="false">
      <Description>Goes
      to a room.</Description>
      <Parameter Name="numb" Type="Room" Optional="false">Target.</Parameter>
    </Function>
  </Functions>
  <Variables>
    <Variable Name="instance_count" Type="Real" Deprecated="false" Get="true" Set="false" Instance="false">Count of instances.</Variable>
  </Variables>
  <Constants>
    <Constant Name="asset_object" Class="AssetType" Type="Real" Deprecated="false">An object.</Constant>
  </Constants>
  <Structures>
    <Structure Name="AnimCurveChannel">
      <Field Name="name" Type="String">Channel name.</Field>
    </Structure>
  </Structures>
  <Enumerations>
    <Enumeration Name="buffer_kind">
      <Member Name="buffer_fixed" Value="0">Fixed size.</Member>
    </Enumeration>
  </Enumerations>
</GameMakerLanguageSpec>`;

const spec = GmlSpec.parse(SAMPLE);

describe('xml reader', () => {
  it('decodes entities in text', () => {
    expect(spec.lookup('buffer_write')).toMatchObject({
      description: 'Writes & data <to> a buffer.',
    });
  });

  it('reads self-closing elements', () => {
    const entry = spec.lookup('no_body');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ kind: 'function', deprecated: true, description: '' });
  });

  it('keeps multi-line text', () => {
    expect((spec.lookup('room_goto') as { description: string }).description).toContain('Goes');
    expect((spec.lookup('room_goto') as { description: string }).description).toContain('to a room');
  });

  it('skips comments and the declaration', () => {
    expect(parseXml(SAMPLE).name).toBe('GameMakerLanguageSpec');
  });
});

describe('spec model', () => {
  it('reads every section', () => {
    expect(spec.runtimeVersion).toBe('2022.4');
    expect(spec.functions).toHaveLength(3);
    expect(spec.variables).toHaveLength(1);
    expect(spec.constants).toHaveLength(1);
    expect(spec.structures).toHaveLength(1);
    expect(spec.enums).toHaveLength(1);
  });

  it('builds signatures with optional markers', () => {
    const entry = spec.lookup('buffer_write');
    expect(signatureOf(entry as never)).toBe(
      'buffer_write(buffer: Id.Buffer, type: Constant.BufferDataType, value?: Any): Real',
    );
  });

  it('summarises each entry kind', () => {
    expect(summarize(spec.lookup('instance_count')!)).toBe('instance_count: Real (read-only)');
    expect(summarize(spec.lookup('asset_object')!)).toBe('asset_object: Real [AssetType]');
    expect(summarize(spec.lookup('AnimCurveChannel')!)).toContain('struct AnimCurveChannel');
    expect(summarize(spec.lookup('buffer_kind')!)).toContain('enum buffer_kind');
  });

  it('knows what exists', () => {
    expect(spec.has('buffer_write')).toBe(true);
    expect(spec.has('buffer_write_packet')).toBe(false);
  });
});

describe('search', () => {
  it('ranks exact matches first', () => {
    expect(spec.search('buffer_write')[0]!.entry.name).toBe('buffer_write');
  });

  it('matches multiple terms against the name', () => {
    expect(spec.search('buffer write')[0]!.entry.name).toBe('buffer_write');
  });

  it('falls back to descriptions', () => {
    expect(spec.search('count of instances').map((r) => r.entry.name)).toContain('instance_count');
  });

  it('demotes deprecated entries', () => {
    const results = spec.search('no_body');
    expect(results[0]!.entry.name).toBe('no_body');
    expect(results[0]!.score).toBeLessThan(1000);
  });

  it('returns nothing for an empty query', () => {
    expect(spec.search('   ')).toEqual([]);
  });
});

describe('suggestions', () => {
  it('finds a near miss for a typo', () => {
    expect(spec.suggest('buffer_writ')).toContain('buffer_write');
    expect(spec.suggest('room_gotoo')).toContain('room_goto');
  });

  it('suggests nothing for something wholly unlike a real name', () => {
    expect(spec.suggest('completely_unrelated_identifier_xyz')).toEqual([]);
  });
});

describe('version comparison', () => {
  it('sorts newest first', () => {
    const versions = ['2023.11.1.129', '2024.14.4.268', '2024.2.0.132'];
    expect([...versions].sort(compareVersions)).toEqual([
      '2024.14.4.268',
      '2024.2.0.132',
      '2023.11.1.129',
    ]);
  });
});

describe.skipIf(findRuntimes().length === 0)('installed runtime', () => {
  const runtimes = findRuntimes();

  it('finds a runtime with a spec', () => {
    expect(runtimes[0]!.specPath).toMatch(/GmlSpec\.xml$/);
    expect(runtimes[0]!.version).toMatch(/^\d+\./);
  });

  it('parses the real spec', () => {
    const real = GmlSpec.load(runtimes[0]!.specPath);
    expect(real.functions.length).toBeGreaterThan(2000);
    // Spot-check functions this project will lean on.
    for (const name of [
      'instance_create_layer',
      'network_create_server_raw',
      'buffer_write',
      'show_debug_message',
      'json_parse',
      'variable_instance_get',
      'script_execute',
      'screen_save',
    ]) {
      expect(real.has(name), `${name} should exist`).toBe(true);
    }
    // And a plausible-sounding function that does not exist.
    expect(real.has('network_send_packet_raw_async')).toBe(false);
  });
});
