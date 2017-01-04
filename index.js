const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const io = require('socket.io');
const mongoURI =  process.env.MONGO_URI || 'mongodb://localhost/todos';
const routes = require('./routes');
const user = require('./routes/user');
const Schema = mongoose.Schema;
const Todo = require('./models/todos.js').init(Schema, mongoose);

mongoose.Promise = global.Promise;

const connectWithRetry = () => (
  mongoose.connect(mongoURI, (err) => {
    if (err) {
      console.error('Failed to connect to mongo on startup - retrying in 5 sec', err);
      setTimeout(connectWithRetry, 5000);
    }
  })
);

connectWithRetry();

mongoose.connection.on('open', () => {
  console.log('Connected to MongoDB');
});

app.set('views', __dirname + '/views');
app.set('view engine', 'pug');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app).listen(process.env.port || 3000, () => {
  console.log('Express server listening on port ' + server.address().port);
});

var sio = io.listen(server);
var users = 0;
var address_list = new Array();

sio.sockets.on('connection', function (socket) {
  var address = socket.handshake.address;

  if (address_list[address]) {
    var socketid = address_list[address].list;
  } else {
    var socketid = new Array();
    address_list[address] = new Array();
  }

  socketid.push(socket.id);
  address_list[address].list = socketid;
  users = Object.keys(address_list).length;

  socket.emit('count', { count: users });
  socket.broadcast.emit('count', { count: users });

  Todo.find({}, function(err, todos) {
    socket.emit('all', todos);
  });

  socket.on('add', function(data) {
    var todo = new Todo({
      title: data.title,
      complete: false
    });

    todo.save(function(err) {
      if (err) throw err;
      socket.emit('added', todo );
      socket.broadcast.emit('added', todo);
    });
  });

  socket.on('delete', function(data) {
    Todo.findById(data.id, function(err, todo) {
      todo.remove(function(err) {
        if (err) throw err;
        socket.emit('deleted', data );
        socket.broadcast.emit('deleted', data);
      });
    });
  });

  socket.on('edit', function(data) {
     Todo.findById(data.id, function(err, todo){
        todo.title = data.title;
        todo.save(function(err){
          if (err) throw err;
          socket.emit('edited', todo);
          socket.broadcast.emit('edited', todo);
        });
      });
  });

  socket.on('changestatus', function(data) {
    Todo.findById(data.id, function(err, todo) {
      todo.complete = data.status === 'complete';
      todo.save(function(err) {
        if (err) throw err;
        socket.emit('statuschanged', data );
        socket.broadcast.emit('statuschanged', data);
      });
    });
  });

  socket.on('allchangestatus', function(data) {
    var master_status = data.status === 'complete';
    Todo.find({}, function(err, todos) {
      for (var i = 0; i < todos.length; i++) {
        todos[i].complete = master_status;
        todos[i].save(function(err) {
          if (err) throw err;
          socket.emit('allstatuschanged', data);
          socket.broadcast.emit('allstatuschanged', data);
        });
      }
    });
  });

  socket.on('disconnect', function() {
    var socketid = address_list[address].list;
    delete socketid[socketid.indexOf(socket.id)];
    if (Object.keys(socketid).length == 0) delete address_list[address];
    users = Object.keys(address_list).length;
    socket.emit('count', { count: users });
    socket.broadcast.emit('count', { count: users });
  });
});

app.get('/', routes.index);
