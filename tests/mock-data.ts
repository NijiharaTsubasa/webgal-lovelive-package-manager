import type { ModelPackage, ResourcePackage } from '../src/catalog';

const model = (group: string, character: string, name: string, description: string): ModelPackage => ({
  name, description, path: `${group}/${character}/${name}`,
  installPath: `3d/figure/${group}/${character}/${name}`,
  url: `https://example.invalid/packed/${name}.zip`, preview: `./previews/${name}.webp`,
});
export const modelPackages: ModelPackage[] = [
  model("μ's", '01高坂穗乃果', 'ch0001_co0002_member', '高坂穗乃果 · 冬季校服'),
  model("μ's", '01高坂穗乃果', 'ch0001_co0012_member', '高坂穗乃果 · 夏季校服'),
  model('Aqours', '01高海千歌', 'ch0101_co0002_member', '高海千歌 · 冬季校服'),
  model('Aqours', '09黑泽露比', 'ch0109_co0002_member', '黑泽露比 · 冬季校服'),
  model('虹咲', '09天王寺璃奈', 'ch0209_co0002_member', '天王寺璃奈 · 冬季校服'),
  model('虹咲', '09天王寺璃奈', 'ch9999_co0002_member', '天王寺璃奈 · 冬季校服（璃奈板）'),
  model('莲之空', '1021乙宗梢', '3d_costume_1001102101', '乙宗梢 · 冬季校服'),
  model('莲之空', '1031日野下花帆', '3d_costume_1001103101', '日野下花帆 · 冬季校服'),
];
export const resourcePackages: ResourcePackage[] = [
  { type: 'motion', name: '莲之空活动记录动作包', description: '动作\n测试说明', installPath: '3d/motion/hasunosora', checkPath: '3d/motion/hasunosora', url: '/others/hasunosora_motions.zip', preview: '/others/kaho_02070.png' },
  { type: 'motion', name: 'LLAS 动作包', description: '动作', installPath: '3d/motion/llas', checkPath: '3d/motion/llas', url: '/others/llas.zip' },
  { type: 'live2d_mot_exp', name: '参数动作与表情包', description: '参数动作', installPath: '3d/mtn_exp', checkPath: '3d/mtn_exp/anon/a.exp.json', url: '/others/parameters.zip' },
  { type: 'background', name: '背景包', description: '背景', installPath: 'background/test', checkPath: 'background/test', url: '/others/background.zip' },
  { type: 'bgm', name: '音乐包', description: '音乐', installPath: 'bgm/test', checkPath: 'bgm/test', url: '/others/bgm.zip' },
  { type: 'figure', name: 'MyGO_Mujica Live2D立绘包', description: '立绘', installPath: 'figure', checkPath: 'figure/anon/model.json', url: '/others/figure.zip' },
];
