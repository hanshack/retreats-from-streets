const { Client } = require('pg');
const { waterfall } = require('async');
const { eachSeries } = require('async');

const tableName = "streets_retreats";
const polygonTable = "city_blocks";
// Your setting here
const client = new Client({
  user: // e.g. 'postgres',
  host: // e.g. '127.0.0.1',
  database: // e.g.'belgium-osm',
  password: 'YOUR_PASSWORD',
  port: // e.g. 5432,
})
client.connect();

// this is the main query
const streetBlocksQuery = `
  WITH

  polygon AS (

    SELECT *
    FROM ${polygonTable}
    WHERE id = $$

  ),

  polygon_within_city AS (

    SELECT ST_Intersection( cgeom , pgeom ) AS pgeom
    FROM city_polygon, polygon

  ),
  
  candiates AS (

    SELECT (ST_dumppoints(I_Grid_Point_Distance(pgeom, 5, 5))).geom AS cgeom 
    FROM polygon_within_city
    
  ),

  lines AS (

    SELECT ST_Boundary(pgeom) As lgeom
    FROM polygon
  ),

  distance AS(

    SELECT ST_Distance(ST_Transform(lgeom,4326)::geography, ST_Transform(cgeom,4326)::geography) As geom, candiates.cgeom 
    FROM lines,candiates
    ORDER BY geom DESC
    LIMIT 1

  ),

  circle AS (

    SELECT
     ST_Transform(
        ST_Buffer(
          ST_Transform(cgeom,4326)::geography,
          geom
        )::geometry
        ,3857) AS cgeom
    FROM distance

  )

  INSERT INTO ${tableName} (
    SELECT *
    FROM distance,circle
  );

`;


waterfall([
    function(callback) {
      // Create a new table
      const createTableQuery = `
        DROP TABLE IF EXISTS ${tableName};
        CREATE TABLE ${tableName} (distance float8, pgeom geometry,cgeom geometry);`;
      client.query(createTableQuery, (err, res) => {
        callback(null);
      })

    },
    function(callback) {
      // select all the city blocks
      const polyonQuery = `SELECT * FROM ${polygonTable}`;
      client.query(polyonQuery, (err, res) => {
        const allPolygons = res.rows;
        callback(null, allPolygons);
      })

    },
    function(allPolygons, callback) {
      // make a query for each city block
      eachSeries(allPolygons, function(file, callbackEach) {
        console.log("city block ", file.id);
        const queryWithId = streetBlocksQuery.replace('$$',file.id);
        client.query(queryWithId, (err, res) => {
          if(allPolygons.length === file.id){
            callback(null, "done")
          }else{
            callbackEach();
          }
          
        })

      });

    }
], function (err, result) {
    console.log("DONE");
    client.end();
});