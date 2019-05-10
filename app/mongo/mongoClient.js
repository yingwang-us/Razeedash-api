/**
* Copyright 2019 IBM Corp. All Rights Reserved.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*      http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

const clone = require('clone');
const MongoDBClient = require('mongodb').MongoClient;
const pLimit = require('p-limit');
const objectPath = require('object-path');

module.exports = class MongoClient {
  constructor(options) {
    let o = clone(options);
    this._mongo = o.mongo;
    this._collectionIndices = {};
    this._client;
  }
  get limit(){
    if(!this._limit){
      this._limit = pLimit(5);
    }
    return this._limit;
  }
  get dbName() {
    return this._mongo.dbName;
  }
  get url() {
    return this._mongo.url;
  }

  get log() {
    const nop = {
      error: () => {},
      info: () => {},
      debug: () => {}
    };
    const result = this._log || nop;
    return result;
  }

  set log(logger){
    this._log=logger;
  }

  async _createCollectionIndexes(collection, collectionName, indices) {
    let indexAdded = false;
    await Promise.all(indices.map(async index => {
      return this.limit(async () => {
        let iname = objectPath.get(index.options.name);
        if(!this._collectionIndices[collectionName].some((e)=>e.name === iname)){
          try {
            collection = collection || await this._getCollection(collectionName);
            await collection.createIndex(index.keys, index.options);
          } catch (e) {
            this.log.error(e,`Failed to create index ${iname} on collection ${collectionName}`);
          }
          indexAdded = true;
        }
      });
    }));
    return indexAdded;
  }

  async _createIndexes(collectionIndices){
    const collectionsToIndex = Object.keys(collectionIndices);
    await Promise.all(collectionsToIndex.map(async collectionName => {
      return this.limit(async () => {
        let indexAdded = false;
        let collection;
        if(!this._collectionIndices[collectionName]){
          collection = await this._getCollection(collectionName);
          this._collectionIndices[collectionName] = await collection.indexes();
        }
        indexAdded = await this._createCollectionIndexes(collection, collectionName, collectionIndices[collectionName]);
        if(indexAdded){
          collection = collection || await this._getCollection(collectionName);
          this._collectionIndices[collectionName] = await collection.indexes();
          this.log.info(`Created new collection ${collectionName} index ${collectionName}`);
        }
      });
    }));
  }

  async _getCollection(collectionName){
    let collection;
    try {
      const db = await this._clientConnect();
      const collectionsArray = await db.listCollections({name:collectionName},{nameOnly:true}).toArray();
      if(collectionsArray.length === 0){
        this.log.debug(`Creating collection ${collectionName}.`);
        collection = await db.createCollection(collectionName);
      } else {
        collection = await db.collection(collectionName);
      }
    } catch (e){
      this.log.error(e,`Error getting collection ${collectionName}.`);
    }
    return collection;
  }

  async _clientConnect(){
    if (!this._client) {
      const options = {useNewUrlParser: true};
      let client = await MongoDBClient.connect(this.url, options);
      this._client = client.db(this.dbName);
    }
    return this._client;
  }

  async getClient(options) {
    await this._clientConnect();
    if(options && typeof options['collection-indexes'] === 'object') {
      await this._createIndexes(options['collection-indexes']);
    }
    return this._client;
  }

};