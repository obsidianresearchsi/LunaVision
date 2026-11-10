import { expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  const query: any = {};
  for (const method of ['select', 'order', 'eq']) query[method] = vi.fn(() => query);
  query.then = (resolve: any) => Promise.resolve({ data: [{ log_id: 'log-1', officer_id: 'off-1' }], error: null }).then(resolve);
  query.single = vi.fn().mockResolvedValue({ data: { search_image_path: 'data:image/png;base64,fixture' }, error: null });
  return { query, from: vi.fn(() => query) };
});
vi.mock('./supabase', () => ({ supabase: { from: mock.from } }));
import { supabaseDb } from './supabaseDb';
it('requests metadata only and filters history at the database when requested', async () => {
  const rows = await supabaseDb.getAuditLogs({ includeImages: false, officerId: 'off-1' });
  expect(mock.query.select).toHaveBeenLastCalledWith('log_id,officer_id,timestamp,result_count,search_type');
  expect(mock.query.eq).toHaveBeenCalledWith('officer_id', 'off-1');
  expect(rows[0]).toMatchObject({ logId: 'log-1', searchImagePath: '' });
});
it('keeps full export reads available and loads one image by its original audit ID', async () => {
  await supabaseDb.getAuditLogs(); expect(mock.query.select).toHaveBeenLastCalledWith('*');
  expect(await supabaseDb.getAuditImage('original-audit')).toBe('data:image/png;base64,fixture');
  expect(mock.query.select).toHaveBeenLastCalledWith('search_image_path');
  expect(mock.query.eq).toHaveBeenLastCalledWith('log_id', 'original-audit');
});
