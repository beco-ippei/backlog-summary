var request = require('request'),
  yaml = require('js-yaml'),
  fs = require('fs');

// load config (yaml)
try {
  var doc = yaml.safeLoad(fs.readFileSync('./config/default.yml', 'utf8'));
} catch (e) {
  console.log('********** failed loading config **********');
  console.dir(e);
  process.exit();
}
var conf = doc.config;
var issue_url = conf.base_url+"/view/";

function push2Slack(ch, msg) {
  var opts = {
    uri: conf.slack_hook.base_url + conf.slack_hook.key_path,
    form: {
      payload: '{"channel": "#'+ch+'", "text": "'+msg+'", "username": "Tasks"}',
    },
    json: true,
  };
  //console.log('push slack **** '+opts.uri);
  request.post(opts, function(err, r, body) {
    if (!err && r.statusCode == 200) {
      console.log('pushed');
    } else {
      console.dir({err: err, body: body});
      console.log(opts.form.payload);
    }
  });
}

function dateToStr(d) {
  return d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate();
}

const MS_DAY = 24 * 60 * 60 * 1000;
var tomorrow = dateToStr(new Date(new Date().getTime() + MS_DAY));
var today = dateToStr(new Date());
var yesterday = dateToStr(new Date(new Date().getTime() - MS_DAY));

var pj_api = conf.base_url+"/api/v2/projects?apiKey="+conf.api_key;
var issues_api = conf.base_url+"/api/v2/issues?apiKey="+conf.api_key;

/**
 * fetch issues recursive
 * https://developer.nulab-inc.com/ja/docs/backlog/api/2/get-issues
 */
function fetchAll(pj_list) {
  if (pj_list.length === 0) {
    return;
  }
  var pj = pj_list.shift();
  console.log("- "+ pj.id + ", code:"+ pj.projectKey +", name:"+ pj.name);
  var channel = conf.target_projects[pj.projectKey];
  if (!channel) {
    fetchAll(pj_list);
    return;   // not target
  }

  var url = issues_api+"&projectId[]="+pj.id;
  for (var i in [1,2,3]) {
    url += "&statusId[]="+i;
  }
  url += "&dueDateUntil="+tomorrow;

  console.log(url);
  request.get({url: url}, function(err, r, body) {
    var data = JSON.parse(body);
    if (data.errors) {
      console.dir(data.errors);
      return;
    }

    var issues = {
      today: [],
      pasts: [],
    };
    data.forEach(function(row) {
      var d = new Date(row.dueDate);
      if (d == 'Invalid Date') {
        return;   //TODO: raise exception ?
      }
      var dueDate = dateToStr(d);
      var issue = {id: row.id, key: row.issueKey, name: row.summary,
          status: row.status.name, due:dueDate};
      if (dueDate === today) {
        issues.today.push(issue);
      } else {
        issues.pasts.push(issue);
      }
    });

    var msg = '';
    if (issues.today.length === 0 && issues.pasts.length === 0) {
      msg = 'Issue not found';
    }
    if (issues.today.length > 0) {
      msg += "[Today's issues]\n";
      issues.today.forEach(function(is) {
        msg += "  :bell: ("+is.status+") "+is.name+" : "+conf.issue_url+is.key+"\n";
      });
    }
    if (issues.pasts.length > 0) {
      msg += "[past issues]\n";
      issues.pasts.forEach(function(is) {
        msg += "  :boom: ["+is.due+"]("+is.status+") "+is.name +" : "
            +conf.issue_url+is.key+"\n";
      });
    }

    //TODO: push to slack
    push2Slack(channel, msg);

    fetchAll(pj_list);
  });
}

// fetch issues
request.get({url: pj_api}, function(err, r, body) {
  var data = JSON.parse(body);

  var pj_list = [];
  data.forEach(function(pj) {
    pj_list.push(pj);
  });

  fetchAll(pj_list);
});

