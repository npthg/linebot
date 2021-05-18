const Amplify =  require('aws-amplify').Amplify;
const configs = require('./src/aws-exports');
Amplify.configure(configs);

const line = require('@line/bot-sdk');

const express = require('express');

const config = require('./config.json');

const app = express();

const server = require("http").Server(app);
const io = require("socket.io")(server);

const translate = require('@vitalets/google-translate-api')

const API = require('aws-amplify').API;
const queries = require('./graphql/queries');
const mutation = require('./graphql/mutations');

const listPosts = queries.listPosts ;
const listBookeds = queries.listBookeds ;
const updateBooked = mutation.updateBooked ;
const deletePost = mutation.deletePost ;
const getUser = queries.getUser;

//---------- Line Message API ------------

const client = new line.Client(config);
var reply_token = "" ;
var line_mess = "" ;
var socketID = "" ;

var lineUserID_app = "" ;
var lineUserID_line

var isForeign = false ;

var letters = /^[0-9a-zA-Z ']+$/;

var bookId = "" ;

const queryPost = async (lineid) => {
  let filterPost = {
    lineUserID:{
      eq: lineid
    }
  }

  let title, image, startTime, endTime, maxGuests, newPrice, address ;



  await API.graphql({ query: listPosts, variables: { filter: filterPost} }).then((res) => {
  
  for(const p of res.data.listPosts.items){
    title = p.title;
    image = p.image;
    startTime = p.startTime;
    endTime = p.endTime;
    maxGuests = p.maxGuests;
    newPrice = p.newPrice;
    address = p.address;
    activity_n = p.activity_n;
  }  

})


  sendActivityInformation(lineid, title, image, startTime, endTime, maxGuests.toString(), newPrice.toString(), address, activity_n.toString())
}


const queryBook = async (lineid) => {
  let filterPost = {
    lineUserID:{
      eq: lineid
    }
  }

  let id = "" ;

  await API.graphql({ query: listPosts, variables: { filter: filterPost} }).then((res) => {
  
  for(const p of res.data.listPosts.items){
    id = p.id
  }  

})

  var todayDate =  new Date().toISOString().slice(0,10);

  let filterBooked = {
    postID:{
      eq: id
    },
    isDone:{
        eq: true
    },
    date:{
        ge: todayDate
    }

  }

  let img, username ;

  await API.graphql({ query: listBookeds, variables: { filter: filterBooked} }).then( async (res) => {
    for(const b of res.data.listBookeds.items){
      await API.graphql({ query: getUser, variables: { id: b.userID} }).then((res) => { 
        img = res.data.getUser.imageUri;
        username = res.data.getUser.username;
        
      })

      sendBooked(lineid, img, username, b.date);
    }  

  })
}


const acceptBook = async () => {
    let updateBook = {
        id: bookId,
        isDone: true
    }

    await API.graphql({ query: updateBooked, variables: {input: updateBook}});
}

const declineBook = async () => {
  let updateBook = {
      id: bookId,
      isDone: null
  }

  await API.graphql({ query: updateBooked, variables: {input: updateBook}});
}

const deletePosts = async (lineid) => {

  let filterPost = {
    lineUserID:{
      eq: lineid
    }
  }

  let p_id = "" ;

  await API.graphql({ query: listPosts, variables: { filter: filterPost} }).then((res) => {
  
  for(const p of res.data.listPosts.items){
    p_id = p.id
  }  

})


  let delPost = {
      id: p_id,
  }

  await API.graphql({ query: deletePost, variables: {input: delPost}});
}

app.post('/', line.middleware(config), (req, res) => {
    
    if (!Array.isArray(req.body.events)) {
        return res.status(500).end();
      }

    Promise.all(req.body.events.map(event => {
        console.log(event);
        lineUserID_line = event.source.userId

        if(event.type == 'postback'){
          if(event.postback.data == 'accept'){
              acceptBook();
              sendText(lineUserID_line, 'ยอมรับการจองเรียบร้อยครับ') ;
          }else if(event.postback.data == 'decline'){
              declineBook();
              sendText(lineUserID_line, 'ปฎิเสธการจองเรียบร้อยครับ') ;
          }else if(event.postback.data == 'delete'){
            sendText(lineUserID_line, 'เพื่อเป็นการยืนยันการลบกรุณาพิมพ์ ลบกิจกรรม') ;
          }
        }
        else{
            line_mess = event.message.text ;

            if(line_mess != ""){ 
              if(lineUserID_line == lineUserID_app){
                  if(isForeign){
                    translate(line_mess, {from: 'th', to: 'en'}).then(res => {          
                      io.to(socketID).emit("line", res.text);
                    }).catch(err => {
                      console.error(err)
                    });
                  }
                  else
                    io.to(socketID).emit("line", line_mess);
                }
              }

            reply_token = event.replyToken ;

            if(line_mess == "ลงทะเบียน"){
              sendForm(lineUserID_line);
            }
            if(line_mess == "การจองทั้งหมด"){
              queryBook(lineUserID_line);
            }
            if(line_mess == "ข้อมูลกิจกรรม"){
              queryPost(lineUserID_line);
            }
            if(line_mess == "ลบกิจกรรม"){
              deletePosts(lineUserID_line);
            }

        }
      })).then(() => res.end())
      .catch((err) => {
        console.error(err);
        res.status(500).end();
      });

      if(reply_token == ""){
        connectAndPush() ;
     }


    }) ;



function connectAndPush(){

      io.on("connection", (socket) => {
          socketID = socket.id ;

          socket.on("chat", (msg, user) => {
            lineUserID_app = user ;

            if(msg.match(letters)){
              isForeign = true ;
              sendTransText(user, msg) ;
            }
            else{ 
              isForeign = false ; 
              sendText(user, msg) ;
            }
          });

          socket.on("place", (date, user, name, guests, bookID) => {
            //sendText(user, "คุณ "+ name + " ได้ทำการจองกิจกรรมของคุณในวันที่ " + date + " จำนวน " + guests+ " คน") ;
            bookId = bookID
            sendConfirm(user, date, name, guests);
          });

      });
}

function sendText(sender, m){
    const message = {
        type: 'text',
        text: m
      };

      client.pushMessage(sender, message);
}

function sendTransText(sender, m){

  translate(m, {from: 'en', to: 'th'}).then(res => {
    const message = {
      type: 'text',
      text: res.text
    };

    client.pushMessage(sender, message);

  }).catch(err => {
    console.error(err)
  });
  
}

function sendForm(sender){

  const messages= [
    {
      type: "template",
      altText: "กรอกข้อมูลได้ผ่านทาง https://docs.google.com/forms/d/e/1FAIpQLSfnGikTSs2ZaiageKM4XxEHLY0gZZgZ8WPFbWFElr0_54vpRQ/viewform?usp=pp_url&entry.985431727="+sender+" หรือ",
      template: {
        type: "buttons",
        thumbnailImageUrl: "https://www.scholarship.in.th/wp-content/uploads/2014/06/176.jpg",
        imageAspectRatio: "rectangle",
        imageSize: "cover",
        imageBackgroundColor: "#FFFFFF",
        title: "ยินดีต้อนรับสู่ Localife",
        text: "กรอกข้อมูลกิจกรรมได้เลยครับ",
        defaultAction: {
          type: "uri",
          label: "กรอกข้อมูล",
          uri: "https://docs.google.com/forms/d/e/1FAIpQLSfnGikTSs2ZaiageKM4XxEHLY0gZZgZ8WPFbWFElr0_54vpRQ/viewform?usp=pp_url&entry.985431727="+sender
        },
        actions: [
          {
            type: "uri",
            label: "กรอกข้อมูล",
            uri: "https://docs.google.com/forms/d/e/1FAIpQLSfnGikTSs2ZaiageKM4XxEHLY0gZZgZ8WPFbWFElr0_54vpRQ/viewform?usp=pp_url&entry.985431727="+sender
          }
        ]
      }
    }
  ]

  client.pushMessage(sender, messages);
}

function sendConfirm(sender, date, name, guests){
  const messages=[
    {
      type: "flex",
      altText: "Confirmation",
      contents:{
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "Confirmation",
              weight: "bold",
              size: "xl"
            },
            {
              type: "box",
              layout: "vertical",
              margin: "lg",
              spacing: "sm",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "ผู้จอง",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      position: "relative"
                    },
                    {
                      type: "text",
                      text: name,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "วันที่",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1
                    },
                    {
                      type: "text",
                      text: date,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "จำนวนคน",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      margin: "none"
                    },
                    {
                      type: "text",
                      text: guests+" คน",
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                }
              ]
            }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              height: "sm",
              action: {
                type: "postback",
                label: "Accept",
                data: "accept"
              }
            },
            {
              type: "button",
              style: "primary",
              height: "sm",
              action: {
                type: "postback",
                label: "Decline",
                data: "decline"
              },
              color: "#C13737"
            },
            {
              type: "spacer",
              size: "sm"
            }
          ],
          flex: 0
        }
      }
    }
    ]
  client.pushMessage(sender, messages);
}

function sendActivityInformation(sender, title, img, startTime, endTime, maxGuests, price, address, activity_n){
  const messages=[
    {
      type: "flex",
      altText: "รายละเอียดกิจกรรม",
      contents:{
        type: "bubble",
        hero: {
          type: "image",
          url: img,
          size: "full",
          aspectRatio: "20:13",
          aspectMode: "cover",
          action: {
            type: "uri",
            uri: "http://linecorp.com/"
          }
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: title,
              weight: "bold",
              size: "xl"
            },
            {
              type: "box",
              layout: "vertical",
              margin: "lg",
              spacing: "sm",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "ที่อยู่",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      position: "relative"
                    },
                    {
                      type: "text",
                      text: address,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "ผู้เข้าร่วมสูงสุดต่อวัน",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1
                    },
                    {
                      type: "text",
                      text: maxGuests,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "เวลาเริ่มกิจกรรม",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      margin: "none"
                    },
                    {
                      type: "text",
                      text: startTime,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "เวลาสิ้นสุดกิจกรรม",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      margin: "none"
                    },
                    {
                      type: "text",
                      text: endTime,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "ราคาต่อวัน",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 1,
                      margin: "none"
                    },
                    {
                      type: "text",
                      text: price,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 3
                    }
                  ]
                }
              ]
            }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "link",
              height: "sm",
              action: {
                type: "uri",
                label: "แก้ไข",
                uri: 'https://docs.google.com/forms/d/e/1FAIpQLSf66juEFo_fIoJeFjRWWIXpe7LnA-hYxeFXHWMjc2e9V_ufoA/viewform?entry.188349860=&entry.987678160=&entry.1307448434='+activity_n+'&entry.114314224='+startTime+'&entry.1566888787='+endTime+'&entry.1458440395='+maxGuests+'&entry.521743234='+price+'&entry.985431727='+sender
              }
            },
            {
              type: "button",
              style: "primary",
              height: "sm",
              action: {
                type: "postback",
                label: "ลบกิจกรรม",
                data: "delete"
              },
              color: "#C13737"
            },
            {
              type: "spacer",
              size: "sm"
            }
          ],
          flex: 0
        }
      }
    }
    ]
  client.pushMessage(sender, messages);
}

function sendBooked(sender, img, username, date){
  const messages=[
    {
      type: "flex",
      altText: "การจองทั้งหมด",
      contents:{
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "image",
                        url: img,
                        aspectMode: "cover",
                        size: "full"
                      }
                    ],
                    cornerRadius: "100px",
                    width: "72px",
                    height: "72px"
                  },
                  {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        contents: [
                          {
                            type: "span",
                            text: username,
                            weight: "bold",
                            color: "#000000"
                          }
                        ],
                        size: "lg",
                        wrap: true
                      },
                      {
                        type: "box",
                        layout: "baseline",
                        contents: [
                          {
                            type: "text",
                            text: "จองวันที่ : "+date,
                            size: "sm",
                            color: "#bcbcbc"
                          }
                        ],
                        spacing: "sm",
                        margin: "md"
                      }
                    ]
                  }
                ],
                spacing: "xl",
                paddingAll: "20px"
              }
            ],
            paddingAll: "0px"
          }
        }
      }
    ];

  client.pushMessage(sender, messages);
}

//---------------- Config Port --------------
const port = config.port;
server.listen(port, () => {
  console.log(`listening on ${port}`);
});

