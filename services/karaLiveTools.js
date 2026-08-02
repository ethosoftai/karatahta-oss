import { generateManimTool, webSearchTool } from './karaTools.js';

export const getFrameTool = {
  name: 'get_frame',
  description: 'Ogrenciyle canli konusurken, video zaman cizelgesinde belirttigin bir andaki gercek video karesini getirir. Ogrenci ekranda o an ne oldugunu soruyorsa veya belirli bir zamandaki bir seyden bahsediyorsa bu araci kullan.',
  parameters: {
    type: 'OBJECT',
    properties: {
      time: {
        type: 'NUMBER',
        description: 'Karenin isteneceği zaman, videonun basindan itibaren saniye cinsinden (orn. 42.5).'
      }
    },
    required: ['time']
  }
};

export function buildKaraLiveTools() {
  return [{ functionDeclarations: [getFrameTool, webSearchTool, generateManimTool] }];
}
