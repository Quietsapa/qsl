/**
 * Plugins and custom types make themselves known to the type checker by
 * extending CustomTypes, CustomTriggers and CustomConditions.
 */
import qsl from '@quietsapa/qsl';

declare module '@quietsapa/qsl' {
    interface CustomTypes {
        iframe: { srcdoc: string; container: string; title?: string };
        'wait-for-global': { name: string };
    }
    interface CustomTriggers {
        [form: `scroll:${number}`]: true;
    }
    interface CustomConditions {
        'network:fast': true;
    }
}

qsl.add({ type: 'iframe', srcdoc: '<p>map</p>', container: '#map', timeout: 3000 }, 'map');
qsl.add({ type: 'wait-for-global', name: 'AcmeComments', depends: ['comments-loader'] });
qsl.setFlowOptions({ trigger: 'scroll:60', condition: 'network:fast' }, 'comments');
qsl.add({ type: 'script', src: '/a.js', trigger: ['scroll:30', 'idle'], condition: ['network:fast', 'ua:device:desktop'] });

// @ts-expect-error an iframe needs its container
qsl.add({ type: 'iframe', srcdoc: '<p>map</p>' });
// @ts-expect-error a registered type still checks its fields
qsl.add({ type: 'wait-for-global', name: 'X', global: 'Y' });
// @ts-expect-error scroll takes a number
qsl.setFlowOptions({ trigger: 'scroll:half' }, 'comments');
