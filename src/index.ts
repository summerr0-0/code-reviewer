import { Probot } from 'probot';
import app from './app';

export = (probot: Probot) => {
  app(probot);
};