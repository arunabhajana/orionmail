import {expect,it} from 'vitest';
import {defaultPreferences,normalizePreferences} from '@/lib/app-preferences';
it('keeps Smart Notifications opt-in while preserving saved choices',()=>{
 expect(defaultPreferences.smartNotifications).toBe(false);
 expect(normalizePreferences({}).smartNotifications).toBe(false);
 expect(normalizePreferences({smartNotifications:'true'}).smartNotifications).toBe(false);
 expect(normalizePreferences({smartNotifications:true}).smartNotifications).toBe(true);
 expect(normalizePreferences({smartNotifications:false}).smartNotifications).toBe(false);
});
