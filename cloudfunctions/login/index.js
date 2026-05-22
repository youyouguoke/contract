const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  console.log('[login] openid:', openid);
  console.log('[login] event.name:', event.name);

  try {
    const { data } = await db.collection('users').where({ _openid: openid }).get();

    if (data.length > 0) {
      const existingUser = data[0];
      console.log('[login] existing user, current name:', existingUser.name);
      if (event.name && event.name !== '微信用户' && event.name !== '' && (existingUser.name === '微信用户' || !existingUser.name)) {
        console.log('[login] updating name from', existingUser.name, 'to', event.name);
        await db.collection('users').doc(existingUser._id).update({
          data: { name: event.name },
        });
        existingUser.name = event.name;
      }
      console.log('[login] returning user name:', existingUser.name);
      return { code: 0, data: existingUser };
    }

    const name = (event.name && event.name !== '微信用户' && event.name !== '') ? event.name : '微信用户';
    const newUser = {
      _openid: openid,
      name,
      phone: event.phone || '',
      avatar: event.avatar || '',
      createdAt: db.serverDate(),
    };
    console.log('[login] new user, name:', name);
    const res = await db.collection('users').add({ data: newUser });
    newUser._id = res._id;

    return { code: 0, data: newUser };
  } catch (e) {
    console.error('[login] error:', e.message);
    return { code: -1, message: e.message };
  }
};
