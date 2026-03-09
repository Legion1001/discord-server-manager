import chalk from 'chalk';

function ts() {
  return new Date().toISOString();
}

function info(message) {
  console.log(`${chalk.blue('[INFO]')} ${chalk.gray(ts())} ${message}`);
}

function success(message) {
  console.log(`${chalk.green('[OK]')} ${chalk.gray(ts())} ${message}`);
}

function warn(message) {
  console.log(`${chalk.yellow('[WARN]')} ${chalk.gray(ts())} ${message}`);
}

function error(message, err) {
  console.error(`${chalk.red('[ERROR]')} ${chalk.gray(ts())} ${message}`);
  if (err) {
    console.error(chalk.red(err.stack || err.message || String(err)));
  }
}

export default { info, success, warn, error };
