import { describe, expect, it } from 'vitest';
import { parseBulkKeywords } from '@/lib/bulk-keywords';
import { bulkItemsCreateSchema } from '@/lib/validation';

describe('parseBulkKeywords', () => {
  it('gives every keyword its own secondary keywords', () => {
    const lines = parseBulkKeywords(
      'Sydney Sweeney | Sydney Sweeney movies, Sydney Sweeney height\n\nJenna Ortega|Jenna Ortega age ,Jenna Ortega boyfriend\r\nEmma Myers\n',
    );
    expect(lines).toEqual([
      { keyword: 'Sydney Sweeney', secondaryKeywords: ['Sydney Sweeney movies', 'Sydney Sweeney height'] },
      { keyword: 'Jenna Ortega', secondaryKeywords: ['Jenna Ortega age', 'Jenna Ortega boyfriend'] },
      { keyword: 'Emma Myers', secondaryKeywords: [] },
    ]);
  });

  it('reads columns pasted from Google Sheets and skips duplicates', () => {
    const lines = parseBulkKeywords('Melissa Esplana\tDusty Baker wife, Melissa Esplana age\tMelissa Baker\nmelissa esplana\tagain\nX\n');
    expect(lines).toEqual([{ keyword: 'Melissa Esplana', secondaryKeywords: ['Dusty Baker wife', 'Melissa Esplana age', 'Melissa Baker'] }]);
  });

  it('is accepted by the bulk create request schema', () => {
    const parsed = bulkItemsCreateSchema.parse({ items: parseBulkKeywords('A1 | b, c\nA2'), websiteId: '' });
    expect(parsed.items.map((i) => [i.keyword, i.secondaryKeywords])).toEqual([
      ['A1', ['b', 'c']],
      ['A2', []],
    ]);
  });
});
