/** 使用示例，先修改为自己的实体，再替换 site-config.js；这里的实体并不存在。 */
export const SITE={
  control:{
    mode:'read-only', // 核对全部实体后，手动改为 live 才允许调用服务。
    timeoutMs:15000,
    devices:[
      {key:'light_living',name:'客厅灯光',kind:'light',entity:'light.my_living_light'},
      {key:'ac_living',name:'客厅空调',kind:'climate',entity:'climate.my_living_ac',onMode:'cool'},
      {key:'floor_living',name:'客厅地暖',kind:'climate',entity:'climate.my_living_floor',onMode:'heat'},
      {key:'fresh',name:'全屋新风',kind:'fan',entity:'fan.my_fresh_air'}
    ],
    scenes:[{key:'home',name:'回家',entity:'scene.my_home'},{key:'leave',name:'离家',entity:'script.my_leave'}]
  },
  camera:{serial:''}, // 只有需要本包的 SD 回放组件时才填自己的序列号。
  weather:{sensors:{feelslike:'sensor.my_weather_feelslike',humidity:'sensor.my_weather_humidity',wind_speed:'sensor.my_weather_wind_speed'}},
  entities:{
    'weather.example_weather':'weather.my_home',
    'camera.example_camera':'camera.my_home',
    'sensor.example_camera_battery':'sensor.my_camera_battery',
    'climate.example_ac_living':'climate.my_living_ac',
    'climate.example_floor_living':'climate.my_living_floor',
    'sensor.example_electricity':'sensor.my_grid_card'
  }
};
/** 按中性别名读取用户显式映射的实体。 */
export function entityId(alias){return SITE.entities[alias]||'';}
